/**
 * Resource Mapping Service — stores old-to-new FHIR resource ID mappings.
 *
 * After each Phase 1 bundle is successfully uploaded, the FHIR server returns
 * a transaction-response Bundle whose entry[].response.location field contains
 * the newly assigned resource URL (e.g. "Patient/987/_history/1").
 *
 * ResourceMappingService stores:
 *   "Patient/100" → "Patient/987"
 *
 * Phase 2 then uses these mappings to rewrite cross-bundle references before
 * building each clinical episode Transaction Bundle.
 *
 * Includes the user-defined manual mapping rules (Practitioner, Location,
 * HealthcareService, Organization) that are loaded at the start of migration.
 */

export class ResourceMappingService {
  private readonly _map = new Map<string, string>();

  /**
   * Store a mapping from an old resource reference to its new target reference.
   * Both arguments should be in "ResourceType/id" format.
   *
   * @example set("Patient/100", "Patient/987")
   */
  set(oldRef: string, newRef: string): void {
    this._map.set(oldRef, newRef);
  }

  /**
   * Retrieve the mapped destination reference, or undefined if not mapped.
   */
  get(oldRef: string): string | undefined {
    return this._map.get(oldRef);
  }

  /** Returns true if oldRef has a known mapping. */
  has(oldRef: string): boolean {
    return this._map.has(oldRef);
  }

  /**
   * Rewrite a single reference string.
   * Returns the mapped destination ref if it exists, otherwise the original ref.
   */
  rewriteRef(ref: string): string {
    return this._map.get(ref) ?? ref;
  }

  /** Expose the underlying map for use with rewriteRefsInNode. */
  getMap(): ReadonlyMap<string, string> {
    return this._map;
  }

  /** Total number of stored mappings. */
  get size(): number {
    return this._map.size;
  }

  /**
   * Parse a FHIR transaction-response Bundle and register the new IDs.
   *
   * The server returns one entry per request entry (same order).
   * entry.response.location looks like "Patient/987/_history/1".
   *
   * @param requestRefs  Array of old "ResourceType/id" refs in the same order
   *                     as the bundle entries that were submitted.
   * @param responseEntries  entry[] from the transaction-response Bundle
   */
  registerResponseMappings(
    requestRefs: string[],
    responseEntries: Array<{ response?: { location?: string; status?: string } }>,
  ): void {
    for (let i = 0; i < requestRefs.length; i++) {
      const oldRef = requestRefs[i];
      const location = responseEntries[i]?.response?.location;
      if (!location) continue;

      // location = "Patient/987/_history/1"  →  "Patient/987"
      const parts = location.split('/');
      if (parts.length >= 2) {
        const newRef = `${parts[0]}/${parts[1]}`;
        this._map.set(oldRef, newRef);
      }
    }
  }
}
