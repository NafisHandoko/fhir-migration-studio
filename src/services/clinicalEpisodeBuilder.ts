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
import { log } from '../store/logStore';
import { useMigrationStore } from '../store/migrationStore';
import type { ResourceMappingService } from './resourceMappingService';
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
  'Questionnaire',
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
 * This is an async generator so the orchestrator can report progress
 * incrementally and abort if cancelled.
 */
export async function* migrateClinicalEpisodes(
  options: ClinicalMigratorOptions,
  mappingService: ResourceMappingService,
  checkStatus: () => Promise<boolean>,
): AsyncGenerator<EpisodeBundleResult> {
  const { source, target, jobId } = options;

  // -------------------------------------------------------------------------
  // Download all clinical resource types into an in-memory index
  // -------------------------------------------------------------------------
  const byType = new Map<FhirResourceType, FhirResource[]>();

  for (const resourceType of CLINICAL_RESOURCE_TYPES) {
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

    // Build intra-bundle uuid map (resources INSIDE this bundle)
    const internalUuidMap = buildInternalUuidMap(episodeResources, EXTERNAL_RESOURCE_TYPES);

    // Build the episode Transaction Bundle
    const bundle = buildEpisodeBundle(
      episodeResources,
      internalUuidMap,
      mappingService.getMap(),
    );

    log({
      level: 'info',
      message: `[Phase 2] Uploading Encounter/${encounterId} bundle (${episodeResources.length} resources)`,
      jobId,
    });

    // Upload and yield result
    const result = await uploadEpisodeBundle(bundle, encounterId, target, jobId);

    // Register any new IDs from the response (e.g. Encounter itself for future cross-refs)
    // Note: For episodes, the mapping is mostly for diagnostic purposes since clinical
    // resources don't cross bundle boundaries. We still register them for completeness.
    if (result.success > 0) {
      const originalRefs = episodeResources.map((r) =>
        r.id ? `${r.resourceType}/${r.id}` : '',
      );
      const responseEntries = (await getLastResponseEntries()) ?? [];
      if (responseEntries.length > 0) {
        mappingService.registerResponseMappings(originalRefs, responseEntries);
      }
    }

    yield result;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a Map<encounterId, FhirResource[]> grouping all clinical resources
 * (Composition, Condition, Observation, etc.) under their parent Encounter.
 *
 * Uses the first "Encounter/id" reference found in each resource.
 */
function buildClinicalIndex(
  byType: Map<FhirResourceType, FhirResource[]>,
  encounters: FhirResource[],
): Map<string, FhirResource[]> {
  const encounterIds = new Set(encounters.map((e) => e.id).filter(Boolean) as string[]);
  const index = new Map<string, FhirResource[]>();

  // Initialise empty arrays for all encounter ids
  for (const id of encounterIds) {
    index.set(id, []);
  }

  const CLINICAL_TYPES: FhirResourceType[] = [
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

  for (const resourceType of CLINICAL_TYPES) {
    const resources = byType.get(resourceType) ?? [];
    for (const resource of resources) {
      const encounterId = extractEncounterRefId(resource);
      if (encounterId && index.has(encounterId)) {
        index.get(encounterId)!.push(resource);
      } else {
        // Resource has no recognizable Encounter ref — log and skip
        log({
          level: 'warn',
          message: `[Phase 2] ${resource.resourceType}/${resource.id} has no Encounter reference — skipping`,
          resourceType,
        });
      }
    }
  }

  return index;
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
