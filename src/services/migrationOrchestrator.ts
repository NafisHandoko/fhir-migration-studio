/**
 * Migration Orchestrator — coordinates the full two-phase migration pipeline.
 *
 * Supports two entry points:
 *
 *   runDirectMigration   — starts a brand new migration, creates a fresh checkpoint
 *   resumeDirectMigration — resumes from an existing checkpoint file on disk
 *
 * Phase 1 — Shared Resources  (sharedResourceMigrator)
 *   Downloads and uploads: Patient, Coverage, Schedule, Slot, Questionnaire.
 *   After each bundle the server-assigned IDs are stored in ResourceMappingService
 *   AND persisted to disk via CheckpointService.
 *   Patient.link.other is handled in two steps (create without → PUT to restore).
 *
 * Phase 2 — Clinical Episodes  (clinicalEpisodeBuilder)
 *   Downloads clinical resource types, groups by Encounter, uploads one bundle
 *   per Encounter. Each successful Encounter is recorded in the checkpoint.
 *
 * On success the checkpoint file is deleted.
 * On error/cancellation the checkpoint file is kept for future resume.
 *
 * See docs/FHIR_RULES.md for the full specification.
 */

import { scanResourceCounts } from './scanner';
import { ResourceMappingService } from './resourceMappingService';
import {
  migrateSharedResources,
  SHARED_RESOURCE_TYPES,
  DEFAULT_SHARED_BUNDLE_SIZE,
} from './sharedResourceMigrator';
import {
  migrateClinicalEpisodes,
  CLINICAL_RESOURCE_TYPES,
} from './clinicalEpisodeBuilder';
import {
  createCheckpoint,
  loadCheckpoint,
  saveCheckpoint,
  deleteCheckpoint,
  checkpointAsDone,
} from './checkpointService';
import { log } from '../store/logStore';
import { useMigrationStore } from '../store/migrationStore';
import type { ServerConfig } from '../types/server';
import type { FhirResourceType } from '../types/fhir';
import type { MappingRule } from '../types/mapping';
import type { MigrationCheckpoint } from '../types/migration';
import { createDefaultJob } from '../types/migration';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Resource types that already exist on the target server and are referenced
 * but NOT migrated. Their IDs are rewritten via user-defined MappingRules.
 */
const MANUALLY_MAPPED_TYPES = new Set<string>([
  'Practitioner',
  'Location',
  'HealthcareService',
  'Organization',
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface MigrationOptions {
  source: ServerConfig;
  target: ServerConfig;
  resourceTypes?: FhirResourceType[];
  /** User-defined reference mapping rules (Practitioner, Location, HealthcareService, Organization) */
  mappingRules: MappingRule[];
  /**
   * Maximum number of resources per Phase 1 Transaction Bundle.
   * Defaults to DEFAULT_SHARED_BUNDLE_SIZE (300).
   */
  bundleSize?: number;
}

/**
 * Start a brand-new direct server-to-server migration.
 * Creates a fresh checkpoint file at the start.
 * Updates the Zustand migration store throughout so the UI stays in sync.
 */
export async function runDirectMigration(options: MigrationOptions): Promise<void> {
  const {
    source,
    target,
    resourceTypes = [...SHARED_RESOURCE_TYPES, ...CLINICAL_RESOURCE_TYPES],
    mappingRules,
    bundleSize = DEFAULT_SHARED_BUNDLE_SIZE,
  } = options;

  const store = useMigrationStore.getState();
  const job = createDefaultJob('direct', resourceTypes);
  job.startedAt = new Date().toISOString();
  store.setJob(job);

  log({ level: 'info', message: `Migration ${job.id} started (new)`, jobId: job.id });

  // Build user-defined mappings record (Practitioner/Location/HealthcareService/Organization)
  const userDefinedMappings: Record<string, string> = {};
  for (const rule of mappingRules) {
    userDefinedMappings[`${rule.resourceType}/${rule.sourceId}`] =
      `${rule.resourceType}/${rule.targetId}`;
  }

  // Create fresh checkpoint including user-defined mappings
  const initialCheckpoint = createCheckpoint(
    job.id,
    source.baseUrl,
    target.baseUrl,
    userDefinedMappings,
  );
  await saveCheckpoint(initialCheckpoint);

  await _runMigration({
    job,
    source,
    target,
    resourceTypes,
    bundleSize,
    mappingRules,
    checkpoint: initialCheckpoint,
  });
}

/**
 * Resume a migration from an existing checkpoint.
 * Restores all ID mappings from disk — no need to re-define mapping rules
 * (they were included in the checkpoint when the migration was first started).
 */
export async function resumeDirectMigration(
  jobId: string,
  serverOverrides: { source: ServerConfig; target: ServerConfig },
): Promise<void> {
  const checkpoint = await loadCheckpoint(jobId);
  if (!checkpoint) {
    throw new Error(`No checkpoint found for job ID: ${jobId}`);
  }

  const { source, target } = serverOverrides;
  const resourceTypes: FhirResourceType[] = [...SHARED_RESOURCE_TYPES, ...CLINICAL_RESOURCE_TYPES];

  const store = useMigrationStore.getState();
  const job = createDefaultJob('direct', resourceTypes);
  // Preserve original start time for display
  job.id = jobId;
  job.startedAt = checkpoint.startedAt;
  store.setJob(job);

  log({ level: 'info', message: `Migration ${jobId} resuming from checkpoint`, jobId });
  log({
    level: 'info',
    message: `Checkpoint: Phase1 [${checkpoint.phase1.completedResourceTypes.join(', ')}] | Phase2 [${checkpoint.phase2.completedEncounterIds.length} encounters] | ${Object.keys(checkpoint.idMappings).length} mappings`,
    jobId,
  });

  // No mappingRules needed — they're already baked into checkpoint.idMappings
  await _runMigration({
    job,
    source,
    target,
    resourceTypes,
    bundleSize: DEFAULT_SHARED_BUNDLE_SIZE,
    mappingRules: [], // already in checkpoint
    checkpoint,
  });
}

// ---------------------------------------------------------------------------
// Internal — shared migration runner
// ---------------------------------------------------------------------------

interface RunMigrationArgs {
  job: ReturnType<typeof createDefaultJob>;
  source: ServerConfig;
  target: ServerConfig;
  resourceTypes: FhirResourceType[];
  bundleSize: number;
  mappingRules: MappingRule[];
  checkpoint: MigrationCheckpoint;
}

async function _runMigration(args: RunMigrationArgs): Promise<void> {
  const { job, source, target, resourceTypes, bundleSize, checkpoint: initialCheckpoint } = args;
  const store = useMigrationStore.getState();

  // Mutable checkpoint — updated and saved after every successful batch/encounter
  let checkpoint = initialCheckpoint;
  const onCheckpoint = (updated: MigrationCheckpoint) => { checkpoint = updated; };

  try {
    for (const rt of resourceTypes) {
      useMigrationStore.getState().updateResourceProgress(rt, {
        total: 0, downloaded: 0, uploaded: 0, failed: 0, skipped: 0,
      });
    }

    // -------------------------------------------------------------------------
    // Shared state: pause/cancel check
    // -------------------------------------------------------------------------
    const checkStatus = async (): Promise<boolean> => {
      let status = useMigrationStore.getState().current?.status;
      if (status === 'cancelled') return false;
      if (status === 'paused') {
        await waitForResume();
        status = useMigrationStore.getState().current?.status;
        if (status === 'cancelled') return false;
      }
      return true;
    };

    // -------------------------------------------------------------------------
    // Scan — count resources per type (UI feedback only, skip on resume)
    // -------------------------------------------------------------------------
    if (checkpoint.phase === 'phase1') {
      store.updateStatus('scanning');
      log({ level: 'info', message: 'Scanning source server...', jobId: job.id });

      await scanResourceCounts(
        source,
        resourceTypes,
        (rt, count) => {
          useMigrationStore.getState().updateResourceProgress(rt, { total: count });
        },
        checkStatus,
      );

      if (!(await checkStatus())) {
        log({ level: 'warn', message: `Migration ${job.id} cancelled during scanning`, jobId: job.id });
        return;
      }
    }

    // -------------------------------------------------------------------------
    // Restore ResourceMappingService from checkpoint
    // -------------------------------------------------------------------------
    const mappingService = new ResourceMappingService();
    for (const [oldRef, newRef] of Object.entries(checkpoint.idMappings)) {
      mappingService.set(oldRef, newRef);
    }

    log({
      level: 'info',
      message: `Restored ${mappingService.size} ID mappings from checkpoint`,
      jobId: job.id,
    });

    // -------------------------------------------------------------------------
    // Phase 1 — Shared Resources
    // -------------------------------------------------------------------------
    if (checkpoint.phase === 'phase1' || checkpoint.phase === 'phase1b') {
      store.updateStatus('uploading');
      log({ level: 'info', message: '[Phase 1] Starting shared resource migration...', jobId: job.id });

      await migrateSharedResources(
        { source, target, bundleSize, jobId: job.id, resourceTypes },
        mappingService,
        checkpoint,
        onCheckpoint,
        checkStatus,
      );

      if (!(await checkStatus())) {
        log({ level: 'warn', message: `Migration ${job.id} cancelled after Phase 1`, jobId: job.id });
        return;
      }

      log({
        level: 'success',
        message: `[Phase 1] Complete. ${mappingService.size} ID mappings registered.`,
        jobId: job.id,
      });
    } else {
      log({ level: 'info', message: '[Phase 1] Already completed (checkpoint) — skipping', jobId: job.id });
    }

    // -------------------------------------------------------------------------
    // Phase 2 — Clinical Episodes
    // -------------------------------------------------------------------------
    store.updateStatus('uploading');
    log({ level: 'info', message: '[Phase 2] Starting clinical episode migration...', jobId: job.id });

    let totalEpisodes = 0;
    let totalSuccess = 0;
    let totalFailed = 0;

    const episodeGenerator = migrateClinicalEpisodes(
      { source, target, jobId: job.id, resourceTypes },
      mappingService,
      checkpoint,
      onCheckpoint,
      checkStatus,
    );

    for await (const result of episodeGenerator) {
      if (result.success === 0 && result.failed === 0 && result.errors.length === 0) {
        // Skipped (already completed in checkpoint)
        continue;
      }
      totalEpisodes++;
      totalSuccess += result.success;
      totalFailed += result.failed;

      if (result.errors.length > 0) {
        log({
          level: 'warn',
          message: `Encounter/${result.encounterId}: ${result.failed} failed entries`,
          jobId: job.id,
          detail: result.errors.slice(0, 5).join('\n'),
        });
      }

      if (!(await checkStatus())) {
        log({ level: 'warn', message: `Migration ${job.id} cancelled during Phase 2`, jobId: job.id });
        break;
      }
    }

    log({
      level: totalFailed > 0 ? 'warn' : 'success',
      message: `[Phase 2] Complete. ${totalEpisodes} episodes: ${totalSuccess} ok, ${totalFailed} failed`,
      jobId: job.id,
    });

    // -------------------------------------------------------------------------
    // Complete — mark checkpoint as done and delete from disk
    // -------------------------------------------------------------------------
    store.updateStatus('validating');
    await new Promise((r) => setTimeout(r, 500));

    checkpoint = checkpointAsDone(checkpoint);
    await saveCheckpoint(checkpoint);  // write 'done' state first
    await deleteCheckpoint(job.id);    // then clean up

    store.completeJob();
    log({ level: 'success', message: `Migration ${job.id} completed`, jobId: job.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    store.setError(msg);
    // Checkpoint is intentionally NOT deleted on error — kept for resume
    log({ level: 'error', message: `Migration ${job.id} failed: ${msg} (checkpoint preserved for resume)`, jobId: job.id });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForResume(): Promise<void> {
  return new Promise((resolve) => {
    const interval = setInterval(() => {
      const status = useMigrationStore.getState().current?.status;
      if (status !== 'paused') {
        clearInterval(interval);
        resolve();
      }
    }, 500);
  });
}

export { MANUALLY_MAPPED_TYPES };
export type { MigrationOptions as DirectMigrationOptions };
