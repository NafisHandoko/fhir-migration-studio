/**
 * Shared Resource Migrator — Phase 1 of the phased migration strategy.
 *
 * Migrates resources that are referenced by clinical episodes but do not
 * themselves contain clinical data:
 *   Patient, Coverage, Schedule, Slot, Questionnaire
 *
 * Two-step Patient process (per FHIR_RULES.md §Patient.link.other Handling):
 *   Step 1a — Create every Patient WITHOUT Patient.link.other.
 *   Step 1b — After ALL patients have been created and their new IDs are known,
 *             PATCH each Patient to restore Patient.link.other using mapped IDs.
 *
 * After each successful bundle upload the server-assigned IDs are registered in
 * ResourceMappingService AND persisted to disk via CheckpointService so the
 * migration can be resumed after a crash without creating duplicates.
 */

import { downloadResourceType } from './downloader';
import { buildSharedResourceBundle } from './bundleBuilder';
import { rewriteResourceRefs } from './referenceRewriter';
import { uploadSingleBundle } from './uploader';
import {
  saveCheckpoint,
  checkpointWithMappings,
  checkpointWithPhase1Type,
  checkpointWithPatientLinkPatched,
  isPhase1TypeComplete,
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

/** Resource types handled in Phase 1 */
export const SHARED_RESOURCE_TYPES: FhirResourceType[] = [
  'Patient',
  'Coverage',
  'Schedule',
  'Slot',
  // 'Questionnaire',
];

/** Default maximum resources per Phase 1 Transaction Bundle */
export const DEFAULT_SHARED_BUNDLE_SIZE = 300;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SharedMigratorOptions {
  source: ServerConfig;
  target: ServerConfig;
  bundleSize?: number;
  jobId: string;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Phase 1 entry point.
 * Downloads and uploads all shared resources, populating mappingService with
 * old→new ID mappings after each successful bundle upload.
 * Checkpoint is saved to disk after each batch so the migration can be resumed.
 *
 * @param options        Source/target server configs and bundle size config
 * @param mappingService Central ID mapping store (mutated in-place)
 * @param checkpoint     Current checkpoint state (mutated in-place via callbacks)
 * @param onCheckpoint   Called with the updated checkpoint after each save
 * @param checkStatus    Returns false when the migration has been cancelled
 */
export async function migrateSharedResources(
  options: SharedMigratorOptions,
  mappingService: ResourceMappingService,
  checkpoint: MigrationCheckpoint,
  onCheckpoint: (updated: MigrationCheckpoint) => void,
  checkStatus: () => Promise<boolean>,
): Promise<void> {
  const { source, target, bundleSize = DEFAULT_SHARED_BUNDLE_SIZE, jobId } = options;

  // -------------------------------------------------------------------------
  // Step 1a: Migrate all non-Patient shared types + Patients WITHOUT link.other
  // -------------------------------------------------------------------------
  const patientResources: FhirResource[] = [];

  for (const resourceType of SHARED_RESOURCE_TYPES) {
    if (!(await checkStatus())) return;

    // Skip resource types already completed in a previous (resumed) run
    if (isPhase1TypeComplete(checkpoint, resourceType)) {
      log({
        level: 'info',
        message: `[Phase 1] Skipping ${resourceType} (already completed in checkpoint)`,
        resourceType,
        jobId,
      });
      // Still need patient resources for Phase 1b — download but don't upload
      if (resourceType === 'Patient') {
        await downloadResourceType(source, resourceType, {
          onPage: (page) => { patientResources.push(...page); },
          shouldContinue: () => {
            const s = useMigrationStore.getState().current?.status;
            return s !== 'cancelled' && s !== 'paused';
          },
        });
      }
      continue;
    }

    log({ level: 'info', message: `[Phase 1] Downloading ${resourceType}...`, resourceType, jobId });

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

    log({
      level: 'info',
      message: `[Phase 1] Downloaded ${resources.length} ${resourceType}`,
      resourceType,
      jobId,
    });

    if (resourceType === 'Patient') {
      // Defer Patient upload — we need to strip link.other first
      patientResources.push(...resources);
    } else {
      checkpoint = await uploadSharedBatch(
        resources, resourceType, bundleSize, target, mappingService, checkpoint, onCheckpoint, jobId, checkStatus,
      );
    }

    if (!(await checkStatus())) return;

    // Mark resource type as fully completed and save checkpoint
    if (!isPhase1TypeComplete(checkpoint, resourceType)) {
      checkpoint = checkpointWithPhase1Type(checkpoint, resourceType);
      onCheckpoint(checkpoint);
      await saveCheckpoint(checkpoint);
    }
  }

  // -------------------------------------------------------------------------
  // Step 1a (continued): Upload Patients WITHOUT Patient.link.other
  // -------------------------------------------------------------------------
  if (!isPhase1TypeComplete(checkpoint, 'Patient')) {
    log({
      level: 'info',
      message: `[Phase 1a] Uploading ${patientResources.length} Patients (without link.other)...`,
      resourceType: 'Patient',
      jobId,
    });

    checkpoint = await uploadSharedBatch(
      patientResources,
      'Patient',
      bundleSize,
      target,
      mappingService,
      checkpoint,
      onCheckpoint,
      jobId,
      checkStatus,
      ['link'], // strip Patient.link entirely so link.other is absent
    );

    checkpoint = checkpointWithPhase1Type(checkpoint, 'Patient');
    onCheckpoint(checkpoint);
    await saveCheckpoint(checkpoint);
  }

  if (!(await checkStatus())) return;

  // -------------------------------------------------------------------------
  // Step 1b: Restore Patient.link.other using the now-available ID mappings
  // -------------------------------------------------------------------------
  if (checkpoint.phase1.patientLinkPatched) {
    log({ level: 'info', message: '[Phase 1b] Patient link.other already patched (checkpoint) — skipping', jobId });
    return;
  }

  const patientsWithLinks = patientResources.filter(
    (p) => Array.isArray((p as Record<string, unknown>).link),
  );

  if (patientsWithLinks.length === 0) {
    log({ level: 'info', message: '[Phase 1b] No Patients have link.other — skipping patch step', jobId });
    checkpoint = checkpointWithPatientLinkPatched(checkpoint);
    onCheckpoint(checkpoint);
    await saveCheckpoint(checkpoint);
    return;
  }

  log({
    level: 'info',
    message: `[Phase 1b] Patching ${patientsWithLinks.length} Patients to restore link.other...`,
    resourceType: 'Patient',
    jobId,
  });

  useMigrationStore.getState().updateStatus('patching');
  await patchPatientLinks(patientsWithLinks, target, mappingService, jobId);

  checkpoint = checkpointWithPatientLinkPatched(checkpoint);
  onCheckpoint(checkpoint);
  await saveCheckpoint(checkpoint);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Split resources into batches of bundleSize, build a Transaction Bundle for each,
 * upload it, register the old→new ID mappings, and save a checkpoint after each batch.
 * Returns the updated checkpoint.
 */
async function uploadSharedBatch(
  resources: FhirResource[],
  resourceType: FhirResourceType,
  bundleSize: number,
  target: ServerConfig,
  mappingService: ResourceMappingService,
  checkpoint: MigrationCheckpoint,
  onCheckpoint: (updated: MigrationCheckpoint) => void,
  jobId: string,
  checkStatus: () => Promise<boolean>,
  stripFields: string[] = [],
): Promise<MigrationCheckpoint> {
  const batches: FhirResource[][] = [];
  for (let i = 0; i < resources.length; i += bundleSize) {
    batches.push(resources.slice(i, i + bundleSize));
  }

  let totalUploaded = 0;
  let totalFailed = 0;

  for (let i = 0; i < batches.length; i++) {
    if (!(await checkStatus())) return checkpoint;

    const batch = batches[i];

    // Rewrite references in each resource using the current mapping
    // (includes manual rules for Practitioner/Location/HealthcareService/Organization
    //  that were registered into mappingService by the orchestrator at startup, as
    //  well as any Patient/Coverage/Slot IDs that have already been migrated).
    const rewrittenBatch = batch.map((r) => rewriteResourceRefs(r, mappingService.getMap()));

    const { bundle, originalRefs } = buildSharedResourceBundle(rewrittenBatch, stripFields);

    log({
      level: 'info',
      message: `[Phase 1] Uploading ${resourceType} bundle ${i + 1}/${batches.length} (${batch.length} resources)`,
      resourceType,
      jobId,
    });

    try {
      const responseBundle = await uploadSingleBundle(target, bundle);
      const entries = responseBundle.entry ?? [];

      // Register new server-assigned IDs in memory
      mappingService.registerResponseMappings(originalRefs, entries);

      // Build a plain-object diff of only the NEW mappings from this batch
      const newMappings: Record<string, string> = {};
      for (let j = 0; j < originalRefs.length; j++) {
        const newRef = mappingService.get(originalRefs[j]);
        if (newRef) newMappings[originalRefs[j]] = newRef;
      }

      // Persist to checkpoint
      checkpoint = checkpointWithMappings(checkpoint, newMappings);
      onCheckpoint(checkpoint);
      await saveCheckpoint(checkpoint);

      // Count results
      let success = 0;
      let failed = 0;
      for (const entry of entries) {
        const code = parseInt((entry.response?.status ?? '').split(' ')[0], 10);
        if (code >= 200 && code < 300) success++;
        else failed++;
      }

      totalUploaded += success;
      totalFailed += failed;

      useMigrationStore.getState().updateResourceProgress(resourceType, {
        uploaded: totalUploaded,
        failed: totalFailed,
      });

      log({
        level: failed > 0 ? 'warn' : 'success',
        message: `[Phase 1] ${resourceType} bundle ${i + 1}/${batches.length}: ${success} ok, ${failed} failed`,
        resourceType,
        jobId,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      totalFailed += batch.length;
      useMigrationStore.getState().updateResourceProgress(resourceType, { failed: totalFailed });
      log({
        level: 'error',
        message: `[Phase 1] ${resourceType} bundle ${i + 1}/${batches.length} failed: ${msg}`,
        resourceType,
        jobId,
      });
    }
  }

  return checkpoint;
}

/**
 * Phase 1b: For each Patient that has a link array, send a PUT with the
 * link.other references rewritten to their destination Patient IDs.
 *
 * Uses PUT (conditional update) so the server replaces the existing Patient
 * resource rather than creating a duplicate.
 */
async function patchPatientLinks(
  patients: FhirResource[],
  target: ServerConfig,
  mappingService: ResourceMappingService,
  jobId: string,
): Promise<void> {
  const { fhirClient } = await import('./fhirClient');
  const { generateUrn } = await import('./bundleBuilder');

  const MIGRATION_MARKER = {
    url: 'https://ehealth.co.id/terminology/initiator-component',
    valueString: 'fhir-migration-tool',
  };

  // Build a Transaction Bundle using PUT entries to update each Patient
  const entries = patients.map((patient) => {
    const newRef = patient.id ? mappingService.get(`Patient/${patient.id}`) : undefined;
    if (!newRef) return null; // Patient wasn't successfully uploaded — skip

    const newId = newRef.split('/')[1];

    // Rewrite link.other references using the mapping
    const rewritten = rewriteResourceRefs(patient, mappingService.getMap());
    // Destructure to avoid duplicate 'resourceType' key when spreading
    const { id: _id, resourceType: _rt, meta, ...rest } = rewritten;
    void _id;
    void _rt;

    // Inline meta cleaning: strip versionId/lastUpdated, inject migration marker
    const { versionId: _v, lastUpdated: _l, ...metaRest } =
      (meta ?? {}) as NonNullable<FhirResource['meta']>;
    void _v; void _l;
    const metaCleaned = {
      ...metaRest,
      extension: [...(metaRest.extension ?? []), MIGRATION_MARKER],
    };

    return {
      fullUrl: generateUrn(),
      resource: { resourceType: 'Patient' as const, id: newId, ...rest, meta: metaCleaned } as FhirResource,
      request: { method: 'PUT' as const, url: `Patient/${newId}` },
    };
  }).filter((e): e is NonNullable<typeof e> => e !== null);

  if (entries.length === 0) {
    log({ level: 'warn', message: '[Phase 1b] No Patients could be patched (mapping missing)', jobId });
    return;
  }

  const patchBundle = {
    resourceType: 'Bundle' as const,
    type: 'transaction' as const,
    entry: entries,
  };

  try {
    await fhirClient.post(target, '/', patchBundle);
    log({
      level: 'success',
      message: `[Phase 1b] Restored link.other for ${entries.length} Patients`,
      resourceType: 'Patient',
      jobId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log({
      level: 'error',
      message: `[Phase 1b] Patient link.other patch failed: ${msg}`,
      resourceType: 'Patient',
      jobId,
    });
  }
}
