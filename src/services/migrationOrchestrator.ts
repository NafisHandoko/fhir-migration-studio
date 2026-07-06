/**
 * Migration orchestrator — coordinates the full migration pipeline:
 * Scan → Download ALL → Map → Build cross-referenced Bundle → Upload → Report
 *
 * Key design: all resource types are downloaded first, then a SINGLE transaction
 * bundle is built containing every resource. Internal references (e.g. a Composition
 * referring to Patient/12345) are rewritten to the urn:uuid assigned to that Patient
 * entry in the same bundle, allowing the FHIR server to resolve them transactionally.
 *
 * References to manually-mapped resources (Practitioner, Location, HealthcareService)
 * are rewritten by the mapper step using user-defined rules — those resources already
 * exist on the target server and are NOT included in the bundle.
 */

import { scanResourceCounts } from './scanner';
import { downloadResourceType } from './downloader';
import { rewriteReferences } from './mapper';
import { buildUuidMap, buildCrossReferencedBundle } from './bundleBuilder';
import { uploadSingleBundle } from './uploader';
import { log } from '../store/logStore';
import { useMigrationStore } from '../store/migrationStore';
import type { ServerConfig } from '../types/server';
import type { FhirResourceType, FhirResource } from '../types/fhir';
import type { MappingRule } from '../types/mapping';
import { createDefaultJob } from '../types/migration';

/** Resource types managed manually by the user — excluded from internal UUID mapping */
const MANUALLY_MAPPED_TYPES = new Set<string>(['Practitioner', 'Location', 'HealthcareService']);

export interface MigrationOptions {
  source: ServerConfig;
  target: ServerConfig;
  resourceTypes: FhirResourceType[];
  mappingRules: MappingRule[];
}

/**
 * Run a full direct server-to-server migration.
 * Updates the Zustand migration store throughout.
 */
export async function runDirectMigration(options: MigrationOptions): Promise<void> {
  const { source, target, resourceTypes, mappingRules } = options;
  const store = useMigrationStore.getState();

  const job = createDefaultJob('direct', resourceTypes);
  job.startedAt = new Date().toISOString();
  store.setJob(job);

  log({ level: 'info', message: `Migration ${job.id} started`, jobId: job.id });

  try {
    // Initialise all resource progress counters to 0 so they appear in the UI immediately
    for (const rt of resourceTypes) {
      useMigrationStore.getState().updateResourceProgress(rt, {
        total: 0, downloaded: 0, uploaded: 0, failed: 0, skipped: 0,
      });
    }

    /**
     * Check the current job status and optionally wait until resumed.
     * Returns false when the job has been cancelled.
     */
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
    // Phase 1: Scan — count resources per type
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

    if (useMigrationStore.getState().current?.status === 'cancelled') {
      log({ level: 'warn', message: `Migration ${job.id} cancelled during scanning`, jobId: job.id });
      return;
    }

    // -----------------------------------------------------------------------
    // Phase 2: Download ALL resource types
    //
    // We accumulate all resources into a flat array and record the index range
    // [start, start + count) for each resource type so we can attribute upload
    // results back to individual types after the single-bundle upload.
    // -----------------------------------------------------------------------
    store.updateStatus('downloading');
    log({ level: 'info', message: 'Downloading all resource types...', jobId: job.id });

    const allResources: FhirResource[] = [];
    /** Records the slice of allResources that belongs to each resource type */
    const typeRanges: Array<{ resourceType: FhirResourceType; start: number; count: number }> = [];

    for (const resourceType of resourceTypes) {
      if (!(await checkStatus())) break;

      log({ level: 'info', message: `Downloading ${resourceType}...`, resourceType, jobId: job.id });

      const startIdx = allResources.length;
      const typeResources: FhirResource[] = [];

      await downloadResourceType(source, resourceType, {
        onPage: (resources, downloaded, total) => {
          typeResources.push(...resources);
          useMigrationStore.getState().updateResourceProgress(resourceType, { total, downloaded });
        },
        shouldContinue: () => {
          const status = useMigrationStore.getState().current?.status;
          return status !== 'cancelled' && status !== 'paused';
        },
      });

      allResources.push(...typeResources);
      typeRanges.push({ resourceType, start: startIdx, count: typeResources.length });

      log({
        level: 'info',
        message: `Downloaded ${typeResources.length} ${resourceType} resources`,
        resourceType,
        jobId: job.id,
      });
    }

    if (useMigrationStore.getState().current?.status === 'cancelled') {
      log({ level: 'warn', message: `Migration ${job.id} cancelled during download`, jobId: job.id });
      return;
    }

    // -----------------------------------------------------------------------
    // Phase 3: Apply manual mapping rules to all resources
    //
    // This rewrites references to Practitioner/Location/HealthcareService using
    // the user-defined rules (e.g. Practitioner/6301786 → Practitioner/ehealth-000004).
    // These resources already exist on the target server and are NOT included in
    // the migration bundle.
    // -----------------------------------------------------------------------
    store.updateStatus('mapping');
    log({ level: 'info', message: 'Applying reference mapping rules...', jobId: job.id });

    const manualMapped = mappingRules.length > 0
      ? allResources.map((r) => rewriteReferences(r, mappingRules))
      : allResources;

    // -----------------------------------------------------------------------
    // Phase 4: Build UUID map + cross-referenced transaction bundle
    //
    // For every migratable resource (non-manually-mapped type), assign a new
    // urn:uuid. Then build ONE bundle where every internal cross-reference
    // (e.g. Composition.subject.reference = "Patient/12345") is replaced with
    // the urn:uuid assigned to that resource's bundle entry ("urn:uuid:abc…").
    // -----------------------------------------------------------------------
    log({ level: 'info', message: 'Building cross-referenced transaction bundle...', jobId: job.id });

    const uuidMap = buildUuidMap(manualMapped, MANUALLY_MAPPED_TYPES);
    const bundle = buildCrossReferencedBundle(manualMapped, uuidMap);

    const totalResources = bundle.entry?.length ?? 0;
    log({
      level: 'info',
      message: `Built bundle with ${totalResources} resources and ${uuidMap.size} internal references`,
      jobId: job.id,
    });

    if (!(await checkStatus())) {
      log({ level: 'warn', message: `Migration ${job.id} cancelled before upload`, jobId: job.id });
      return;
    }

    // -----------------------------------------------------------------------
    // Phase 5: Upload the single bundle
    // -----------------------------------------------------------------------
    store.updateStatus('uploading');
    log({ level: 'info', message: `Uploading bundle (${totalResources} resources)...`, jobId: job.id });

    const responseBundle = await uploadSingleBundle(target, bundle);

    // -----------------------------------------------------------------------
    // Phase 6: Parse response and attribute results per resource type
    //
    // The FHIR server returns one response entry per request entry, in the same
    // order. We use the recorded typeRanges to slice the response entries and
    // count successes/failures per type.
    // -----------------------------------------------------------------------
    const responseEntries = responseBundle.entry ?? [];
    let totalSuccess = 0;
    let totalFailed = 0;

    for (const { resourceType, start, count } of typeRanges) {
      const typeEntries = responseEntries.slice(start, start + count);
      let success = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const entry of typeEntries) {
        const statusStr = entry.response?.status ?? '';
        const code = parseInt(statusStr.split(' ')[0], 10);
        if (code >= 200 && code < 300) {
          success++;
        } else {
          failed++;
          if (statusStr) errors.push(statusStr);
        }
      }

      useMigrationStore.getState().updateResourceProgress(resourceType, {
        uploaded: success,
        failed,
      });

      totalSuccess += success;
      totalFailed += failed;

      log({
        level: failed > 0 ? 'warn' : 'success',
        message: `${resourceType}: ${success} ok, ${failed} failed`,
        resourceType,
        jobId: job.id,
        detail: errors.length > 0 ? errors.slice(0, 10).join('\n') : undefined,
      });
    }

    log({
      level: totalFailed > 0 ? 'warn' : 'success',
      message: `Upload complete: ${totalSuccess} ok, ${totalFailed} failed`,
      jobId: job.id,
    });

    // -----------------------------------------------------------------------
    // Phase 7: Complete
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

/** Wait until migration is no longer paused or is cancelled */
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
