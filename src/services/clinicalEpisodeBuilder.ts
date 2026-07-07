/**
 * Clinical Episode Builder — Phase 2 of the phased migration strategy.
 *
 * Groups clinical resources by Encounter and yields one small Transaction Bundle
 * per Encounter. This preserves atomicity for each clinical episode while
 * preventing HTTP 413 errors caused by bundling everything together.
 *
 * Per FHIR_RULES.md §Phase 2:
 *   Each bundle contains resources belonging to ONE Encounter:
 *     Appointment (only if not yet uploaded)
 *     Encounter
 *     Composition
 *     Condition, Observation, AllergyIntolerance, ClinicalImpression
 *     Procedure, ProcedureRequest
 *     MedicationRequest, MedicationDispense
 *     Consent (if present)
 *     AuditEvent (if present)
 *
 * UUID strategy (per FHIR_RULES.md §UUID Strategy):
 *   - Resources inside the same bundle reference each other via urn:uuid
 *   - Resources outside the bundle (Patient, Practitioner, Slot, etc.) are
 *     rewritten to their destination IDs via ResourceMappingService
 *
 * Reference rewriting (per FHIR_RULES.md §Reference Rewriting):
 *   Before building each bundle, every reference that points to an already-
 *   migrated shared resource is replaced with the destination ID from
 *   ResourceMappingService. Only intra-bundle references keep their urn:uuid.
 */

import { downloadResourceType } from './downloader';
import { buildEpisodeBundle, buildInternalUuidMap } from './bundleBuilder';
import { uploadSingleBundle } from './uploader';
import {
  saveCheckpoint,
  checkpointWithEncounter,
  isEncounterComplete,
} from './checkpointService';
import { log } from '../store/logStore';
import { useMigrationStore } from '../store/migrationStore';
import type { ResourceMappingService } from './resourceMappingService';
import type { MigrationCheckpoint } from '../types/migration';
import type { ServerConfig } from '../types/server';
import type { FhirResource, FhirResourceType } from '../types/fhir';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Clinical resource types that are grouped under an Encounter.
 * Order matters: Appointment and Encounter must come first so their urn:uuid
 * is available when Composition (which references both) is processed.
 */
export const CLINICAL_RESOURCE_TYPES: FhirResourceType[] = [
  'Appointment',
  'Encounter',
  'Composition',
  'Condition',
  'Observation',
  'AllergyIntolerance',
  'ClinicalImpression',
  'Procedure',
  'ProcedureRequest',
  'MedicationRequest',
  'MedicationDispense',
  'Consent',
  'AuditEvent',
];

/**
 * Types that are resolved via ResourceMappingService (already exist on target).
 * These are excluded from the internal urn:uuid map for each episode bundle.
 */
const EXTERNAL_RESOURCE_TYPES = new Set<string>([
  'Patient',
  'Coverage',
  'Schedule',
  'Slot',
  // 'Questionnaire',
  'Practitioner',
  'Location',
  'HealthcareService',
  'Organization',
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClinicalMigratorOptions {
  source: ServerConfig;
  target: ServerConfig;
  jobId: string;
  /** If provided, only download clinical resource types in this list (user's selection). */
  resourceTypes?: FhirResourceType[];
}

export interface EpisodeBundleResult {
  encounterId: string;
  success: number;
  failed: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Phase 2 entry point.
 *
 * Downloads all clinical resource types, groups them by Encounter, builds and
 * uploads one Transaction Bundle per Encounter, and yields a result per episode.
 *
 * Supports resume: Encounters listed in `checkpoint.phase2.completedEncounterIds`
 * are skipped entirely. After each successful upload the checkpoint is updated
 * and saved to disk.
 *
 * This is an async generator so the orchestrator can report progress
 * incrementally and abort if cancelled.
 */
export async function* migrateClinicalEpisodes(
  options: ClinicalMigratorOptions,
  mappingService: ResourceMappingService,
  checkpoint: MigrationCheckpoint,
  onCheckpoint: (updated: MigrationCheckpoint) => void,
  checkStatus: () => Promise<boolean>,
): AsyncGenerator<EpisodeBundleResult> {
  const { source, target, jobId, resourceTypes } = options;

  // Only download/process types the user selected (defaults to all clinical types)
  const typesToFetch = resourceTypes
    ? CLINICAL_RESOURCE_TYPES.filter((rt) => resourceTypes.includes(rt))
    : CLINICAL_RESOURCE_TYPES;

  // -------------------------------------------------------------------------
  // Download all clinical resource types into an in-memory index
  // -------------------------------------------------------------------------
  const byType = new Map<FhirResourceType, FhirResource[]>();

  for (const resourceType of typesToFetch) {
    if (!(await checkStatus())) return;

    log({ level: 'info', message: `[Phase 2] Downloading ${resourceType}...`, resourceType, jobId });

    const resources: FhirResource[] = [];
    await downloadResourceType(source, resourceType, {
      onPage: (page, downloaded, total) => {
        resources.push(...page);
        useMigrationStore.getState().updateResourceProgress(resourceType, { total, downloaded });
      },
      shouldContinue: () => {
        const s = useMigrationStore.getState().current?.status;
        return s !== 'cancelled' && s !== 'paused';
      },
    });

    byType.set(resourceType, resources);
    log({
      level: 'info',
      message: `[Phase 2] Downloaded ${resources.length} ${resourceType}`,
      resourceType,
      jobId,
    });
  }

  if (!(await checkStatus())) return;

  // -------------------------------------------------------------------------
  // Index resources by Encounter reference
  // -------------------------------------------------------------------------
  const encounters = byType.get('Encounter') ?? [];
  const appointments = byType.get('Appointment') ?? [];

  // Build Appointment lookup by id
  const appointmentById = new Map<string, FhirResource>();
  for (const appt of appointments) {
    if (appt.id) appointmentById.set(appt.id, appt);
  }

  // Track which Appointments have already been included in a bundle
  const uploadedAppointmentIds = new Set<string>();

  // Group clinical resources by Encounter id
  const clinicalByEncounterId = buildClinicalIndex(byType, encounters);

  log({
    level: 'info',
    message: `[Phase 2] Grouped resources for ${encounters.length} Encounters`,
    jobId,
  });

  // -------------------------------------------------------------------------
  // Build and upload one bundle per Encounter
  // -------------------------------------------------------------------------
  for (const encounter of encounters) {
    if (!(await checkStatus())) return;

    const encounterId = encounter.id ?? 'unknown';

    // Skip Encounters already completed in a previous (resumed) run
    if (isEncounterComplete(checkpoint, encounterId)) {
      log({
        level: 'info',
        message: `[Phase 2] Encounter/${encounterId}: already completed (checkpoint) — skipping`,
        jobId,
      });
      yield { encounterId, success: 0, failed: 0, errors: [] };
      continue;
    }

    // Collect Appointment for this Encounter (if not yet uploaded)
    const appointmentRef = extractAppointmentRef(encounter);
    const appointmentId = appointmentRef ? appointmentRef.split('/')[1] : undefined;
    const episodeResources: FhirResource[] = [];

    if (appointmentId && !uploadedAppointmentIds.has(appointmentId)) {
      const appt = appointmentById.get(appointmentId);
      if (appt) {
        episodeResources.push(appt);
        uploadedAppointmentIds.add(appointmentId);
      }
    }

    // Add Encounter + clinical resources
    episodeResources.push(encounter);
    const clinicals = clinicalByEncounterId.get(encounterId) ?? [];
    episodeResources.push(...clinicals);

    if (episodeResources.length === 0) {
      log({ level: 'warn', message: `[Phase 2] Encounter/${encounterId}: no resources — skipping`, jobId });
      continue;
    }

    // Deduplicate resources to prevent having multiple copies of Encounter/Appointment/etc. in the same bundle
    const uniqueMap = new Map<string, FhirResource>();
    for (const r of episodeResources) {
      if (r.id) {
        uniqueMap.set(`${r.resourceType}/${r.id}`, r);
      } else {
        uniqueMap.set(`temp-${Math.random()}`, r);
      }
    }
    const deduplicatedResources = Array.from(uniqueMap.values());

    // Build intra-bundle uuid map (resources INSIDE this bundle)
    const internalUuidMap = buildInternalUuidMap(deduplicatedResources, EXTERNAL_RESOURCE_TYPES);

    // Build the episode Transaction Bundle
    const bundle = buildEpisodeBundle(
      deduplicatedResources,
      internalUuidMap,
      mappingService.getMap(),
    );

    log({
      level: 'info',
      message: `[Phase 2] Uploading Encounter/${encounterId} bundle (${deduplicatedResources.length} resources)`,
      jobId,
    });

    // Upload and yield result
    const result = await uploadEpisodeBundle(bundle, encounterId, target, jobId);

    // Register any new IDs from the response (e.g. Encounter itself for future cross-refs)
    if (result.success > 0) {
      const originalRefs = deduplicatedResources.map((r) =>
        r.id ? `${r.resourceType}/${r.id}` : '',
      );
      const responseEntries = (await getLastResponseEntries()) ?? [];
      if (responseEntries.length > 0) {
        mappingService.registerResponseMappings(originalRefs, responseEntries);
      }

      // Persist this Encounter as completed in the checkpoint
      checkpoint = checkpointWithEncounter(checkpoint, encounterId);
      onCheckpoint(checkpoint);
      await saveCheckpoint(checkpoint);
    }

    yield result;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a Map<encounterId, FhirResource[]> grouping all clinical resources
 * under their parent Encounter.
 *
 * Strategy (Composition-driven):
 *   1. Index all downloaded clinical resources by "ResourceType/id".
 *   2. For each Encounter, find its Composition (via Composition.encounter /
 *      Composition.context reference).
 *   3. Recursively follow every reference inside Composition to collect all
 *      dependent resources (Condition, Observation, MedicationRequest, etc.),
 *      even those that have no direct Encounter reference.
 *
 * This is more robust than the old "scan each resource for encounter ref"
 * approach because Composition is the explicit manifest of all clinical data
 * for an episode.
 */
function buildClinicalIndex(
  byType: Map<FhirResourceType, FhirResource[]>,
  encounters: FhirResource[],
): Map<string, FhirResource[]> {
  // -------------------------------------------------------------------
  // 1. Build a flat "ResourceType/id" → FhirResource index
  // -------------------------------------------------------------------
  const byId = new Map<string, FhirResource>();
  for (const [, resources] of byType.entries()) {
    for (const resource of resources) {
      if (resource.id) {
        byId.set(`${resource.resourceType}/${resource.id}`, resource);
      }
    }
  }

  // -------------------------------------------------------------------
  // 2. Index Compositions by their Encounter reference
  // -------------------------------------------------------------------
  const compositions = byType.get('Composition') ?? [];
  const compositionByEncounterId = new Map<string, FhirResource>();
  for (const comp of compositions) {
    const encId = extractEncounterRefId(comp);
    if (encId) compositionByEncounterId.set(encId, comp);
  }

  // -------------------------------------------------------------------
  // 3. For each Encounter, collect all resources via Composition
  // -------------------------------------------------------------------
  const index = new Map<string, FhirResource[]>();

  for (const encounter of encounters) {
    const encounterId = encounter.id;
    if (!encounterId) continue;

    const composition = compositionByEncounterId.get(encounterId);
    if (!composition) {
      log({
        level: 'warn',
        message: `[Phase 2] Encounter/${encounterId}: no Composition found — episode will have no clinical resources`,
        resourceType: 'Composition',
      });
      index.set(encounterId, []);
      continue;
    }

    const episodeDeps: FhirResource[] = [composition];
    const visitedRefs = new Set<string>([`Composition/${composition.id}`]);

    // Recursively follow all references reachable from this Composition
    collectCompositionResources(composition, byId, visitedRefs, episodeDeps);

    index.set(encounterId, episodeDeps);
  }

  return index;
}

/**
 * Recursively walk all reference strings inside `resource` and collect
 * the referenced resources from `byId`. Only clinical resources that exist
 * in `byId` are included (external refs like Patient, Practitioner etc. are
 * ignored — they are handled by ResourceMappingService).
 */
function collectCompositionResources(
  resource: FhirResource,
  byId: Map<string, FhirResource>,
  visited: Set<string>,
  out: FhirResource[],
): void {
  const refs = extractAllRefStrings(resource as Record<string, unknown>);
  for (const ref of refs) {
    if (visited.has(ref)) continue;
    const dep = byId.get(ref);
    if (!dep) continue; // external resource (Patient, Practitioner, etc.) — skip
    visited.add(ref);
    out.push(dep);
    // Recurse so MedicationDispense → MedicationRequest chains are followed
    collectCompositionResources(dep, byId, visited, out);
  }
}

/**
 * Walk a JSON node tree and collect all non-urn reference strings.
 * Only returns references of the form "ResourceType/id".
 */
function extractAllRefStrings(node: Record<string, unknown>): string[] {
  const refs: string[] = [];
  collectRefStringsInto(node, refs);
  return refs;
}

function collectRefStringsInto(node: unknown, out: string[]): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectRefStringsInto(item, out);
    return;
  }
  const obj = node as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key === 'reference' && typeof obj[key] === 'string') {
      const ref = obj[key] as string;
      // Only include relative references that look like ResourceType/id
      if (!ref.startsWith('urn:') && !ref.startsWith('http') && ref.includes('/')) {
        // Strip query string or fragment if present
        out.push(ref.split('?')[0].split('#')[0]);
      }
    } else {
      collectRefStringsInto(obj[key], out);
    }
  }
}



/**
 * Extract the Appointment reference string from an Encounter.
 * FHIR DSTU3 Encounter uses Encounter.appointment (Reference).
 */
function extractAppointmentRef(encounter: FhirResource): string | undefined {
  const r = encounter as Record<string, unknown>;
  const appt = r['appointment'] as Record<string, unknown> | undefined;
  if (appt && typeof appt.reference === 'string') return appt.reference;
  return undefined;
}

/**
 * Extract the Encounter reference ID from a resource's encounter field,
 * context field, or the first reference found of type Encounter.
 */
function extractEncounterRefId(resource: FhirResource): string | undefined {
  const r = resource as Record<string, unknown>;

  // Common field names that point to an Encounter
  for (const field of ['encounter', 'context']) {
    const val = r[field] as Record<string, unknown> | undefined;
    if (val && typeof val.reference === 'string' && val.reference.startsWith('Encounter/')) {
      return val.reference.split('/')[1];
    }
  }

  return undefined;
}

/** Upload one episode bundle, returning a structured result. */
async function uploadEpisodeBundle(
  bundle: import('../types/fhir').Bundle,
  encounterId: string,
  target: ServerConfig,
  jobId: string,
): Promise<EpisodeBundleResult> {
  try {
    const responseBundle = await uploadSingleBundle(target, bundle);
    const entries = responseBundle.entry ?? [];

    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const entry of entries) {
      const code = parseInt((entry.response?.status ?? '').split(' ')[0], 10);
      if (code >= 200 && code < 300) {
        success++;
      } else {
        failed++;
        errors.push(`${entry.fullUrl ?? '?'}: ${entry.response?.status}`);
      }
    }

    // Cache the response entries so the caller can register mappings
    _lastResponseEntries = entries;

    log({
      level: failed > 0 ? 'warn' : 'success',
      message: `[Phase 2] Encounter/${encounterId}: ${success} ok, ${failed} failed`,
      jobId,
    });

    return { encounterId, success, failed, errors };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    _lastResponseEntries = [];
    log({
      level: 'error',
      message: `[Phase 2] Encounter/${encounterId} bundle upload failed: ${msg}`,
      jobId,
    });
    return { encounterId, success: 0, failed: bundle.entry?.length ?? 0, errors: [msg] };
  }
}

// Simple module-level cache to pass response entries back to the generator
// without changing the async function signature
let _lastResponseEntries: Array<{ response?: { location?: string; status?: string } }> = [];
async function getLastResponseEntries() {
  return _lastResponseEntries;
}
