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

/**
 * Checkpoint persisted to disk after each successful bundle upload.
 * Used to resume a migration after an app crash or server disconnection.
 *
 * File location: {AppLocalData}/checkpoints/{jobId}.json
 */
export interface MigrationCheckpoint {
  /** Schema version — bump if the shape changes incompatibly */
  version: 1;
  jobId: string;
  startedAt: string;
  /** Base URL of the source FHIR server (for display purposes on resume) */
  sourceUrl: string;
  /** Base URL of the target FHIR server (for display purposes on resume) */
  targetUrl: string;
  /** Current phase — updated as migration progresses */
  phase: 'phase1' | 'phase1b' | 'phase2' | 'done';
  phase1: {
    /** Resource types that have been fully uploaded (all batches successful) */
    completedResourceTypes: FhirResourceType[];
    /** True once Phase 1b (Patient.link.other restore) has completed */
    patientLinkPatched: boolean;
  };
  phase2: {
    /** Encounter IDs that have been successfully uploaded */
    completedEncounterIds: string[];
  };
  /**
   * All known ID mappings — both user-defined (Practitioner/Location/
   * HealthcareService/Organization) and server-assigned (Patient/Schedule/Slot/…).
   * Format: { "Patient/100": "Patient/987", "HealthcareService/6301787": "HealthcareService/105" }
   */
  idMappings: Record<string, string>;
}

/** Summary shown in the UI "Resume Migration" list */
export interface CheckpointSummary {
  jobId: string;
  startedAt: string;
  sourceUrl: string;
  targetUrl: string;
  phase: MigrationCheckpoint['phase'];
  completedPhase1Types: number;
  completedEncounters: number;
  totalMappings: number;
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
