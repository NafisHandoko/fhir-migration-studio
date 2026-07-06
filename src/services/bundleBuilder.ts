/**
 * Bundle Builder — builds FHIR DSTU3 Transaction Bundles from a list of resources.
 *
 * Two modes:
 *
 * 1. buildTransactionBundles (used by NDJSON Import)
 *    Simple batch builder — each resource gets a random urn:uuid, no cross-reference
 *    rewriting. Suitable for NDJSON import where refs are already resolved.
 *
 * 2. buildCrossReferencedBundle (used by Direct Migration)
 *    Builds ONE bundle from ALL resources across ALL types.
 *    Each migratable resource gets a stable urn:uuid (derived from its original id).
 *    ALL internal references (e.g. Patient/12345) are rewritten to their corresponding
 *    urn:uuid within the same bundle, enabling the FHIR server to resolve them
 *    transactionally.
 *    References to manually-mapped resources (Practitioner, Location, HealthcareService)
 *    are already rewritten to their target IDs by the mapper before this step —
 *    those resources are NOT included in the bundle because they already exist on target.
 */

import type { Bundle, BundleEntry, FhirResource } from '../types/fhir';

/** Maximum resources per batch for the simple (NDJSON import) path */
const BUNDLE_BATCH_SIZE = 100000;

/**
 * Generate a new urn:uuid identifier.
 * Exported so the orchestrator can pre-generate the uuid map.
 */
export function generateUrn(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `urn:uuid:${crypto.randomUUID()}`;
  }
  // Fallback — not cryptographically secure but fine for IDs
  const hex = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
  return `urn:uuid:${hex()}-${hex().slice(0, 4)}-4${hex().slice(0, 3)}-${hex().slice(0, 4)}-${hex()}${hex().slice(0, 4)}`;
}

/**
 * Extension stamped onto every resource sent to the target server.
 * Allows easy identification of migrated resources in the future.
 */
const MIGRATION_MARKER: { url: string; valueString: string } = {
  url: 'https://ehealth.co.id/terminology/initiator-component',
  valueString: 'fhir-migration-tool',
};

/**
 * Strip server-assigned meta fields (versionId, lastUpdated), keep everything
 * else (extension, profile, tag), and inject the migration marker extension.
 * Always returns a Meta object — never undefined.
 */
function cleanMeta(meta: FhirResource['meta']): FhirResource['meta'] {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { versionId: _v, lastUpdated: _l, ...rest } = (meta ?? {}) as NonNullable<FhirResource['meta']>;
  return {
    ...rest,
    // Append the migration marker to the existing extensions (preserving originals)
    extension: [...(rest.extension ?? []), MIGRATION_MARKER],
  } as FhirResource['meta'];
}

// ---------------------------------------------------------------------------
// Simple builder (NDJSON import path)
// ---------------------------------------------------------------------------

/**
 * Builds a single FHIR Transaction Bundle from a list of resources.
 * Each resource gets a new random urn:uuid fullUrl and a POST request entry.
 * No internal cross-reference rewriting is performed.
 */
export function buildTransactionBundle(resources: FhirResource[]): Bundle {
  const entries: BundleEntry[] = resources.map((resource) => {
    const { id: _id, meta, ...rest } = resource;
    void _id;

    return {
      fullUrl: generateUrn(),
      resource: { ...rest, meta: cleanMeta(meta) } as FhirResource,
      request: { method: 'POST', url: resource.resourceType },
    };
  });

  return { resourceType: 'Bundle', type: 'transaction', entry: entries };
}

/**
 * Split a large list of resources into multiple Transaction Bundles.
 */
export function buildTransactionBundles(
  resources: FhirResource[],
  batchSize: number = BUNDLE_BATCH_SIZE,
): Bundle[] {
  const bundles: Bundle[] = [];
  for (let i = 0; i < resources.length; i += batchSize) {
    bundles.push(buildTransactionBundle(resources.slice(i, i + batchSize)));
  }
  return bundles;
}

// ---------------------------------------------------------------------------
// Cross-referenced builder (Direct Migration path)
// ---------------------------------------------------------------------------

/**
 * Recursively walk a JSON value and rewrite any "reference" string using refMap.
 * Does NOT mutate the input — returns a new deep copy.
 */
function rewriteRefsInNode(node: unknown, refMap: Map<string, string>): unknown {
  if (node === null || node === undefined) return node;
  if (Array.isArray(node)) return node.map((item) => rewriteRefsInNode(item, refMap));
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      if (key === 'reference' && typeof obj[key] === 'string') {
        const orig = obj[key] as string;
        result[key] = refMap.get(orig) ?? orig;
      } else {
        result[key] = rewriteRefsInNode(obj[key], refMap);
      }
    }
    return result;
  }
  return node;
}

/**
 * Build a stable UUID map for all resources that are NOT in mappableTypes.
 *
 * Returns a Map<"ResourceType/originalId", "urn:uuid:new-uuid">.
 * This map is used both to:
 *   - assign the correct fullUrl to each bundle entry
 *   - rewrite internal cross-resource references within the bundle
 *
 * Resources whose type is in mappableTypes (Practitioner, Location, HealthcareService)
 * are excluded — their target IDs are already known via manual mapping rules and their
 * references have already been rewritten by the mapper.
 */
export function buildUuidMap(
  resources: FhirResource[],
  mappableTypes: ReadonlySet<string>,
): Map<string, string> {
  const uuidMap = new Map<string, string>();
  for (const resource of resources) {
    if (!resource.id) continue;
    if (mappableTypes.has(resource.resourceType)) continue;
    const ref = `${resource.resourceType}/${resource.id}`;
    if (!uuidMap.has(ref)) {
      uuidMap.set(ref, generateUrn());
    }
  }
  return uuidMap;
}

/**
 * Builds ONE FHIR Transaction Bundle containing ALL resources with full
 * cross-reference resolution.
 *
 * For each resource:
 *   - fullUrl is set to the urn:uuid from uuidMap (keyed by "ResourceType/originalId")
 *   - The resource id is stripped (target server assigns a new one)
 *   - meta.versionId and meta.lastUpdated are stripped; other meta fields are kept
 *   - All "reference" fields in the resource body are rewritten using uuidMap,
 *     so that e.g. Composition.subject.reference "Patient/12345" becomes
 *     "urn:uuid:abc..." — the same fullUrl assigned to the Patient entry
 *
 * Manual-mapping references (Practitioner, Location, HealthcareService) are already
 * rewritten to "ResourceType/targetId" format by the mapper before this call and are
 * NOT present in uuidMap — they pass through unchanged.
 *
 * @param resources All resources to include (manual refs already rewritten by mapper)
 * @param uuidMap   Built by buildUuidMap() — maps originalRef → urn:uuid
 */
export function buildCrossReferencedBundle(
  resources: FhirResource[],
  uuidMap: Map<string, string>,
): Bundle {
  const entries: BundleEntry[] = resources.map((resource) => {
    // Determine this entry's fullUrl from the pre-built uuid map
    const originalRef = resource.id ? `${resource.resourceType}/${resource.id}` : null;
    const fullUrl = (originalRef ? uuidMap.get(originalRef) : null) ?? generateUrn();

    // Strip id & clean meta (also injects migration marker)
    const { id: _id, meta, ...rest } = resource;
    void _id;

    // Rewrite internal cross-references within this resource's body
    const bodyToRewrite: Record<string, unknown> = { ...rest, meta: cleanMeta(meta) };
    const rewritten = rewriteRefsInNode(bodyToRewrite, uuidMap) as Record<string, unknown>;

    return {
      fullUrl,
      resource: { resourceType: resource.resourceType, ...rewritten } as FhirResource,
      request: { method: 'POST', url: resource.resourceType },
    };
  });

  return { resourceType: 'Bundle', type: 'transaction', entry: entries };
}
