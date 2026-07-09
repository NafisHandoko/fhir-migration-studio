/**
 * Resource Mapping Service — stores old-to-new FHIR resource ID mappings.
 *
 * After each bundle is successfully uploaded, the FHIR server returns a
 * transaction-response Bundle whose entry[].response.location field contains
 * the newly assigned resource URL (e.g. "Patient/987/_history/1").
 *
 * ResourceMappingService stores:
 *   "Patient/100" → "Patient/987"
 *
 * The dependency migrator uses these mappings to rewrite cross-bundle references
 * before building each Transaction Bundle.
 *
 * Also includes the user-defined manual mapping rules (Practitioner, Location,
 * HealthcareService, Organization) that are loaded at the start of migration.
 *
 * Per docs/FHIR_RULES.md §Resource Mapping Service:
 *   save(resourceType, oldId, newId)
 *   get(resourceType, oldId)
 *   exists(resourceType, oldId)
 */

export class ResourceMappingService {
  private readonly _map = new Map<string, string>();

  // ---------------------------------------------------------------------------
  // High-level typed API (per FHIR_RULES.md spec)
  // ---------------------------------------------------------------------------

  /**
   * Save a mapping for a specific resource type.
   * @example save("Patient", "100", "987")
   * → stored as "Patient/100" → "Patient/987"
   */
  save(resourceType: string, oldId: string, newId: string): void {
    this._map.set(`${resourceType}/${oldId}`, `${resourceType}/${newId}`);
  }

  /**
   * Retrieve the new destination ID for a resource, or undefined if not mapped.
   * @example get("Patient", "100") → "987"  (or undefined)
   */
  getById(resourceType: string, oldId: string): string | undefined {
    const newRef = this._map.get(`${resourceType}/${oldId}`);
    if (!newRef) return undefined;
    return newRef.split('/')[1];
  }

  /**
   * Returns true if the resource has a known mapping.
   * @example exists("Patient", "100") → true/false
   */
  exists(resourceType: string, oldId: string): boolean {
    return this._map.has(`${resourceType}/${oldId}`);
  }

  // ---------------------------------------------------------------------------
  // Low-level ref-string API (backward-compatible)
  // ---------------------------------------------------------------------------

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
   * @example get("Patient/100") → "Patient/987"
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
   * entry.response.location can be:
   *   - Relative: "Patient/987/_history/1"
   *   - Absolute: "http://server/fhir/Patient/987/_history/1"
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

      // Extract "ResourceType/id" from either relative or absolute URL.
      // Regex matches the first segment that looks like a FHIR resource type
      // (capital letter followed by letters) followed by "/id".
      // Examples:
      //   "Patient/987/_history/1"              → "Patient/987"
      //   "http://server/fhir/Patient/987/_history/1" → "Patient/987"
      const match = location.match(/\b([A-Z][a-zA-Z]+)\/([^\/\s]+)/);
      if (match) {
        const newRef = `${match[1]}/${match[2].split('?')[0].split('#')[0]}`;
        this._map.set(oldRef, newRef);
      }
    }
  }
}
