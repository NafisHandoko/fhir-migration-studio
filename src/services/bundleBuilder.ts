/**
 * Bundle Builder — builds FHIR DSTU3 Transaction Bundles.
 *
 * Two exported builders:
 *
 * 1. buildTransactionBundle / buildTransactionBundles  (NDJSON import path)
 *    Simple batch builder — each resource gets a random urn:uuid, no cross-reference
 *    rewriting. Suitable for NDJSON import where refs are already resolved.
 *
 * 2. buildResourceTypeBundle  (Dependency Migration Pipeline)
 *    Builds a Transaction Bundle for a batch of resources of a SINGLE resource type.
 *    References have already been rewritten by the caller (via referenceRewriter +
 *    ResourceMappingService) before this function is called.
 *    Returns the ordered list of original refs alongside the bundle so the caller can
 *    register the server-assigned IDs in ResourceMappingService.
 *
 * Per docs/FHIR_RULES.md §Transaction Bundles:
 *   Each bundle should only contain resources of a single resource type.
 *   Bundle size is configurable (default 100).
 */

import type { Bundle, BundleEntry, FhirResource } from '../types/fhir';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum request body size for FHIR Transaction Bundles (7 MB).
 * Provides a 1 MB margin below the target ingress body size limit of 8 MB.
 */
export const MAX_REQUEST_SIZE_BYTES = 7 * 1024 * 1024;

const encoder = new TextEncoder();

/**
 * Calculate the serialized size of a FHIR Bundle in bytes.
 */
export function calculateSerializedSize(bundle: Bundle): number {
  return encoder.encode(JSON.stringify(bundle)).length;
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
 * Generate a new urn:uuid identifier.
 * Exported so callers can pre-generate uuid maps.
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
): Bundle[] {
  const bundles: Bundle[] = [];
  let currentBatch: FhirResource[] = [];

  for (const resource of resources) {
    const candidateBatch = [...currentBatch, resource];
    const candidateBundle = buildTransactionBundle(candidateBatch);
    const size = calculateSerializedSize(candidateBundle);

    if (currentBatch.length > 0 && size > MAX_REQUEST_SIZE_BYTES) {
      bundles.push(buildTransactionBundle(currentBatch));
      currentBatch = [resource];
    } else {
      currentBatch = candidateBatch;
    }
  }

  if (currentBatch.length > 0) {
    bundles.push(buildTransactionBundle(currentBatch));
  }

  return bundles;
}

// ---------------------------------------------------------------------------
// 2. Resource-type bundle (Dependency Migration Pipeline)
// ---------------------------------------------------------------------------

export interface ResourceTypeBundleResult {
  bundle: Bundle;
  /**
   * Original "ResourceType/id" refs in the same order as bundle.entry[].
   * Used by the caller to register old→new mappings after the server responds.
   */
  originalRefs: string[];
}

/**
 * Build a Transaction Bundle for a batch of resources of a SINGLE resource type.
 *
 * Each resource:
 *   - Gets a stable urn:uuid as fullUrl
 *   - Has its id stripped (the server assigns a new one)
 *   - Has meta cleaned and migration marker injected
 *
 * IMPORTANT: References must have already been rewritten by the caller before
 * passing resources here (using rewriteResourceRefs + ResourceMappingService).
 *
 * @param resources    Batch of resources — must all be the same resource type
 * @param stripFields  Optional extra top-level fields to remove (e.g. ["link"]
 *                     to strip Patient.link before Phase 1a upload)
 */
export function buildResourceTypeBundle(
  resources: FhirResource[],
  stripFields: string[] = [],
): ResourceTypeBundleResult {
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

/**
 * @deprecated Use buildResourceTypeBundle instead.
 * Kept for backward compatibility during the transition.
 */
export const buildSharedResourceBundle = buildResourceTypeBundle;
