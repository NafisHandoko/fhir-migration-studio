/**
 * Migration orchestrator — coordinates the full migration pipeline:
 * Scan → Download → Map → Build Bundles → Upload → Report
 *
 * This is the main entry point for the Direct Migration feature.
 * All progress is reported through the Zustand migration store.
 */

import { scanResourceCounts } from './scanner';
import { downloadResourceType } from './downloader';
import { rewriteReferences } from './mapper';
import { buildTransactionBundles } from './bundleBuilder';
import { uploadBundles } from './uploader';
import { log } from '../store/logStore';
import { useMigrationStore } from '../store/migrationStore';
import type { ServerConfig } from '../types/server';
import type { FhirResourceType, FhirResource } from '../types/fhir';
import type { MappingRule } from '../types/mapping';
import { createDefaultJob } from '../types/migration';

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
    // Initialize progress totals to 0 first (so they appear in the UI)
    for (const rt of resourceTypes) {
      useMigrationStore.getState().updateResourceProgress(rt, {
        total: 0,
        downloaded: 0,
        uploaded: 0,
        failed: 0,
        skipped: 0,
      });
    }

    const checkStatus = async () => {
      let status = useMigrationStore.getState().current?.status;
      if (status === 'cancelled') return false;
      if (status === 'paused') {
        await waitForResume();
        status = useMigrationStore.getState().current?.status;
        if (status === 'cancelled') return false;
      }
      return true;
    };

    // Phase 1: Scan
    store.updateStatus('scanning');
    log({ level: 'info', message: 'Scanning source server...', jobId: job.id });
    
    await scanResourceCounts(
      source,
      resourceTypes,
      (rt, count) => {
        useMigrationStore.getState().updateResourceProgress(rt, {
          total: count,
        });
      },
      checkStatus
    );

    // Stop if cancelled during scanning
    if (useMigrationStore.getState().current?.status === 'cancelled') {
      log({ level: 'warn', message: `Migration ${job.id} cancelled during scanning phase`, jobId: job.id });
      return;
    }

    // Phase 2-4: Download, Map, Upload per resource type
    for (const resourceType of resourceTypes) {
      if (useMigrationStore.getState().current?.status === 'cancelled') break;
      if (useMigrationStore.getState().current?.status === 'paused') {
        // Wait until resumed or cancelled
        await waitForResume();
      }

      log({ level: 'info', message: `Processing ${resourceType}...`, resourceType, jobId: job.id });
      store.updateStatus('downloading');

      const allResources: FhirResource[] = [];

      await downloadResourceType(source, resourceType, {
        onPage: (resources, downloaded, total) => {
          allResources.push(...resources);
          useMigrationStore.getState().updateResourceProgress(resourceType, {
            total,
            downloaded,
          });
        },
        shouldContinue: () => {
          const status = useMigrationStore.getState().current?.status;
          return status !== 'cancelled' && status !== 'paused';
        },
      });

      // Phase 3: Map references
      store.updateStatus('mapping');
      const mapped = allResources.map((r) => rewriteReferences(r, mappingRules));

      // Phase 4: Build bundles
      const bundles = buildTransactionBundles(mapped);

      // Phase 5: Upload
      store.updateStatus('uploading');
      await uploadBundles(
        target,
        bundles,
        resourceType,
        (result) => {
          useMigrationStore.getState().updateResourceProgress(resourceType, {
            uploaded: result.success,
            failed: result.failed,
          });
        },
        () => {
          const status = useMigrationStore.getState().current?.status;
          return status !== 'cancelled' && status !== 'paused';
        }
      );
    }

    // Phase 6: Complete
    store.updateStatus('validating');
    await new Promise((r) => setTimeout(r, 500)); // brief pause for UX
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
