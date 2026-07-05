/**
 * Bundle Builder — builds FHIR DSTU3 Transaction Bundles from a list of resources.
 *
 * Rules per FHIR_RULES.md:
 * - Method: POST (creates new resources on target)
 * - fullUrl: urn:uuid:{uuid} for each new resource
 * - Internal references use urn:uuid:... (handled by mapper before this step)
 * - References to existing resources on target use ResourceType/id
 */

import type { Bundle, BundleEntry, FhirResource } from '../types/fhir';

/** Maximum resources per transaction bundle */
const BUNDLE_BATCH_SIZE = 50;

function generateUrn(): string {
  // Use crypto.randomUUID if available, else fallback
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `urn:uuid:${crypto.randomUUID()}`;
  }
  // Fallback (not cryptographically secure but fine for IDs)
  const hex = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
  return `urn:uuid:${hex()}-${hex().slice(0, 4)}-4${hex().slice(0, 3)}-${hex().slice(0, 4)}-${hex()}${hex().slice(0, 4)}`;
}

/**
 * Builds a single FHIR Transaction Bundle from a list of resources.
 * Each resource gets a new urn:uuid fullUrl and a POST request entry.
 */
export function buildTransactionBundle(resources: FhirResource[]): Bundle {
  const entries: BundleEntry[] = resources.map((resource) => {
    // Strip server-assigned fields that should not carry over
    const { id: _id, meta: _meta, ...rest } = resource;
    void _id;
    void _meta;

    return {
      fullUrl: generateUrn(),
      resource: rest as FhirResource,
      request: {
        method: 'POST',
        url: resource.resourceType,
      },
    };
  });

  return {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: entries,
  };
}

/**
 * Split a large list of resources into multiple Transaction Bundles.
 * Default batch size is 50 resources per bundle.
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
