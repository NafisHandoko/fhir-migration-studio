/**
 * Migration job and progress types.
 */

import type { FhirResourceType } from './fhir';

export type MigrationStatus =
  | 'idle'
  | 'scanning'
  | 'downloading'
  | 'mapping'
  | 'uploading'
  | 'patching'     // Phase 1b: restoring Patient.link.other after all Patients are created
  | 'validating'
  | 'done'
  | 'error'
  | 'paused'
  | 'cancelled';

export type MigrationMode = 'direct' | 'export' | 'import';

export interface ResourceProgress {
  total: number;
  downloaded: number;
  uploaded: number;
  failed: number;
  skipped: number;
}

export interface MigrationJob {
  id: string;
  mode: MigrationMode;
  status: MigrationStatus;
  resourceTypes: FhirResourceType[];
  progress: Partial<Record<FhirResourceType, ResourceProgress>>;
  startedAt?: string;
  completedAt?: string;
  error?: string;
  /** Running counters across all resource types */
  totals: {
    total: number;
    downloaded: number;
    uploaded: number;
    failed: number;
    skipped: number;
  };
}

export interface MigrationReport {
  jobId: string;
  mode: MigrationMode;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  resourceTypes: FhirResourceType[];
  summary: Partial<Record<FhirResourceType, ResourceProgress>>;
  totals: MigrationJob['totals'];
  status: MigrationStatus;
  error?: string;
}

export function createDefaultJob(
  mode: MigrationMode,
  resourceTypes: FhirResourceType[],
): MigrationJob {
  return {
    id: `MIG-${Date.now()}`,
    mode,
    status: 'idle',
    resourceTypes,
    progress: {},
    totals: { total: 0, downloaded: 0, uploaded: 0, failed: 0, skipped: 0 },
  };
}

/** Compute overall percentage 0–100 */
export function computeOverallProgress(job: MigrationJob): number {
  const { total, uploaded, failed, skipped } = job.totals;
  if (total === 0) return 0;
  return Math.round(((uploaded + failed + skipped) / total) * 100);
}
