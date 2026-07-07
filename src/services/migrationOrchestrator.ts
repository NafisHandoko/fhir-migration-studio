/**
 * Migration Orchestrator — coordinates the full two-phase migration pipeline.
 *
 * Phase 1 — Shared Resources  (sharedResourceMigrator)
 *   Downloads and uploads: Patient, Coverage, Schedule, Slot, Questionnaire.
 *   After each bundle upload the server-assigned IDs are stored in
 *   ResourceMappingService for use in Phase 2.
 *   Patient.link.other is handled in two steps (Step 1a: create without links,
 *   Step 1b: PUT to restore links after all Patient IDs are known).
 *
 * Phase 2 — Clinical Episodes  (clinicalEpisodeBuilder)
 *   Downloads clinical resource types (Appointment, Encounter, Composition,
 *   Condition, Observation, …) and groups them by Encounter.
 *   One small Transaction Bundle is uploaded per Encounter.
 *   References to shared resources are rewritten using ResourceMappingService.
 *   References within the same bundle use urn:uuid.
 *
 * Manual Mapping (mapper)
 *   Applied BEFORE Phase 1 & 2 to all resources.
 *   Rewrites references to Practitioner, Location, HealthcareService, Organization
 *   using user-defined rules (these resources already exist on the target server).
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
import { log } from '../store/logStore';
import { useMigrationStore } from '../store/migrationStore';
import type { ServerConfig } from '../types/server';
import type { FhirResourceType } from '../types/fhir';
import type { MappingRule } from '../types/mapping';
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
  /**
   * Resource types to migrate.
   * If omitted, all SHARED + CLINICAL types are migrated.
   */
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
 * Run a full direct server-to-server migration using the two-phase strategy.
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

  log({ level: 'info', message: `Migration ${job.id} started`, jobId: job.id });

  try {
    // Initialise progress counters
    for (const rt of resourceTypes) {
      useMigrationStore.getState().updateResourceProgress(rt, {
        total: 0, downloaded: 0, uploaded: 0, failed: 0, skipped: 0,
      });
    }

    // -----------------------------------------------------------------------
    // Shared state: check/wait for pause/cancel
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // Scan — count resources per type (UI feedback only)
    // -----------------------------------------------------------------------
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

    // -----------------------------------------------------------------------
    // Central ID mapping service — populated by Phase 1, consumed by Phase 2
    // -----------------------------------------------------------------------
    const mappingService = new ResourceMappingService();

    // Register user-defined manual mapping rules into the mapping service
    // so Phase 2 reference rewriter can resolve Practitioner/Location/etc.
    for (const rule of mappingRules) {
      mappingService.set(
        `${rule.resourceType}/${rule.sourceId}`,
        `${rule.resourceType}/${rule.targetId}`,
      );
    }

    log({
      level: 'info',
      message: `Loaded ${mappingRules.length} manual mapping rules into ResourceMappingService`,
      jobId: job.id,
    });

    // -----------------------------------------------------------------------
    // Phase 1 — Shared Resources
    // -----------------------------------------------------------------------
    store.updateStatus('uploading');
    log({ level: 'info', message: '[Phase 1] Starting shared resource migration...', jobId: job.id });

    await migrateSharedResources(
      { source, target, bundleSize, jobId: job.id },
      mappingService,
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

    // -----------------------------------------------------------------------
    // Phase 2 — Clinical Episodes
    // -----------------------------------------------------------------------
    store.updateStatus('uploading');
    log({ level: 'info', message: '[Phase 2] Starting clinical episode migration...', jobId: job.id });

    let totalEpisodes = 0;
    let totalSuccess = 0;
    let totalFailed = 0;

    const episodeGenerator = migrateClinicalEpisodes(
      { source, target, jobId: job.id },
      mappingService,
      checkStatus,
    );

    for await (const result of episodeGenerator) {
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

    // -----------------------------------------------------------------------
    // Complete
    // -----------------------------------------------------------------------
    store.updateStatus('validating');
    await new Promise((r) => setTimeout(r, 500)); // brief UX pause
    store.completeJob();
    log({ level: 'success', message: `Migration ${job.id} completed`, jobId: job.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    store.setError(msg);
    log({ level: 'error', message: `Migration ${job.id} failed: ${msg}`, jobId: job.id });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wait until migration is no longer paused or is cancelled. */
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

// Keep these re-exports for backward-compat with any UI code that imports them
export { MANUALLY_MAPPED_TYPES };
export type { MigrationOptions as DirectMigrationOptions };
