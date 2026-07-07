/**
 * Bundle Builder — builds FHIR DSTU3 Transaction Bundles.
 *
 * Three exported builders:
 *
 * 1. buildTransactionBundle / buildTransactionBundles  (NDJSON import path)
 *    Simple batch builder — each resource gets a random urn:uuid, no cross-reference
 *    rewriting. Suitable for NDJSON import where refs are already resolved.
 *
 * 2. buildSharedResourceBundle  (Phase 1 — Shared Resources)
 *    Builds a Transaction Bundle for a batch of shared resources (Patient, Coverage,
 *    Schedule, Slot, Questionnaire). No internal cross-reference rewriting needed
 *    because these resource types don't reference each other within the same batch.
 *    Returns the ordered list of original refs alongside the bundle so the caller can
 *    register the server-assigned IDs in ResourceMappingService.
 *
 * 3. buildEpisodeBundle  (Phase 2 — Clinical Episodes)
 *    Builds ONE Transaction Bundle for a single clinical episode (one Encounter).
 *    Resources within the bundle reference each other via urn:uuid.
 *    Resources outside the bundle (Patient, Practitioner, etc.) are rewritten using
 *    the externalRefMap from ResourceMappingService.
 */

import { rewriteRefsInNode } from './referenceRewriter';
import type { Bundle, BundleEntry, FhirResource } from '../types/fhir';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum resources per batch for the simple (NDJSON import) path */
const BUNDLE_BATCH_SIZE = 100000;

/**
 * Extension stamped onto every resource sent to the target server.
 * Allows easy identification of migrated resources in the future.
 */
const MIGRATION_MARKER: { url: string; valueString: string } = {
  url: 'https://ehealth.co.id/terminology/initiator-component',
  valueString: 'fhir-migration-tool',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a new urn:uuid identifier.
 * Exported so orchestrators can pre-generate uuid maps.
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
 * Strip server-assigned meta fields (versionId, lastUpdated), keep everything
 * else (extension, profile, tag), and inject the migration marker extension.
 * Always returns a Meta object — never undefined.
 */
function cleanMeta(meta: FhirResource['meta']): FhirResource['meta'] {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { versionId: _v, lastUpdated: _l, ...rest } = (meta ?? {}) as NonNullable<FhirResource['meta']>;
  return {
    ...rest,
    extension: [...(rest.extension ?? []), MIGRATION_MARKER],
  } as FhirResource['meta'];
}

// ---------------------------------------------------------------------------
// 1. Simple builder (NDJSON import path)
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
// 2. Shared Resource Bundle (Phase 1)
// ---------------------------------------------------------------------------

export interface SharedBundleResult {
  bundle: Bundle;
  /**
   * Original "ResourceType/id" refs in the same order as bundle.entry[].
   * Used by the caller to register old→new mappings after the server responds.
   */
  originalRefs: string[];
}

/**
 * Build a Transaction Bundle for a batch of shared resources (Patient, Coverage,
 * Schedule, Slot, Questionnaire).
 *
 * Each resource:
 *   - Gets a stable urn:uuid derived from its original id
 *   - Has its id stripped (the server assigns a new one)
 *   - Has meta cleaned and migration marker injected
 *
 * NOTE: Patient.link.other references are intentionally stripped here.
 * They are restored in a separate Phase 1b PATCH step after all Patients exist.
 *
 * @param resources  Batch of shared resources
 * @param stripFields  Optional extra top-level fields to remove (used to strip
 *                     Patient.link before Phase 1a upload)
 */
export function buildSharedResourceBundle(
  resources: FhirResource[],
  stripFields: string[] = [],
): SharedBundleResult {
  const originalRefs: string[] = [];

  const entries: BundleEntry[] = resources.map((resource) => {
    const urn = generateUrn();
    const originalRef = resource.id ? `${resource.resourceType}/${resource.id}` : null;
    if (originalRef) originalRefs.push(originalRef);
    else originalRefs.push(urn); // edge case: resource without id

    // Strip server-assigned id + meta + any caller-specified fields
    const { id: _id, meta, ...rest } = resource;
    void _id;

    let body: Record<string, unknown> = { ...rest, meta: cleanMeta(meta) };
    for (const field of stripFields) {
      delete body[field];
    }
    // Remove undefined values
    body = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));

    return {
      fullUrl: urn,
      resource: { resourceType: resource.resourceType, ...body } as FhirResource,
      request: { method: 'POST', url: resource.resourceType },
    };
  });

  return {
    bundle: { resourceType: 'Bundle', type: 'transaction', entry: entries },
    originalRefs,
  };
}

// ---------------------------------------------------------------------------
// 3. Clinical Episode Bundle (Phase 2)
// ---------------------------------------------------------------------------

/**
 * Build ONE Transaction Bundle for a single clinical episode (one Encounter
 * and all its associated resources).
 *
 * Reference strategy:
 *   - Resources inside this bundle reference each other via urn:uuid  (internalUuidMap)
 *   - Resources outside this bundle (Patient, Practitioner, Slot, etc.) are
 *     rewritten to their destination IDs via externalRefMap (ResourceMappingService)
 *
 * The combined map is: externalRefMap first, then internalUuidMap — internal
 * refs take precedence so that intra-bundle links are always urn:uuid.
 *
 * @param resources      All resources belonging to this episode
 * @param internalUuidMap  Map<"ResourceType/oldId", "urn:uuid:…"> for resources
 *                         that are part of THIS bundle
 * @param externalRefMap   ReadonlyMap<"ResourceType/oldId", "ResourceType/newId">
 *                         from ResourceMappingService for already-migrated resources
 */
export function buildEpisodeBundle(
  resources: FhirResource[],
  internalUuidMap: Map<string, string>,
  externalRefMap: ReadonlyMap<string, string>,
): Bundle {
  // Merge: external first so internal (urn:uuid) overrides for intra-bundle refs
  const mergedRefMap = new Map<string, string>([...externalRefMap, ...internalUuidMap]);

  const entries: BundleEntry[] = resources.map((resource) => {
    const originalRef = resource.id ? `${resource.resourceType}/${resource.id}` : null;
    const fullUrl = (originalRef ? internalUuidMap.get(originalRef) : null) ?? generateUrn();

    const { id: _id, meta, ...rest } = resource;
    void _id;

    const bodyToRewrite: Record<string, unknown> = { ...rest, meta: cleanMeta(meta) };
    const rewritten = rewriteRefsInNode(bodyToRewrite, mergedRefMap) as Record<string, unknown>;

    return {
      fullUrl,
      resource: { resourceType: resource.resourceType, ...rewritten } as FhirResource,
      request: { method: 'POST', url: resource.resourceType },
    };
  });

  return { resourceType: 'Bundle', type: 'transaction', entry: entries };
}

/**
 * Build the urn:uuid map for resources that will be included in a single episode bundle.
 * Maps "ResourceType/originalId" → "urn:uuid:…".
 *
 * @param resources   Resources that will be in this bundle
 * @param excludeTypes  Types that should NOT get a uuid (they are external references
 *                      resolved via ResourceMappingService instead)
 */
export function buildInternalUuidMap(
  resources: FhirResource[],
  excludeTypes: ReadonlySet<string> = new Set(),
): Map<string, string> {
  const map = new Map<string, string>();
  for (const resource of resources) {
    if (!resource.id) continue;
    if (excludeTypes.has(resource.resourceType)) continue;
    const ref = `${resource.resourceType}/${resource.id}`;
    if (!map.has(ref)) {
      map.set(ref, generateUrn());
    }
  }
  return map;
}
