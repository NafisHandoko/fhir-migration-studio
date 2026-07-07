/**
 * Checkpoint Service — persists migration state to disk using @tauri-apps/plugin-fs.
 *
 * Checkpoint files are written to:
 *   {AppLocalData}/checkpoints/{jobId}.json
 *
 * A checkpoint is saved after every successful bundle upload so that if the app
 * crashes or the server goes down, the migration can be resumed from the last
 * successful point without creating duplicates on the target server.
 *
 * The checkpoint contains:
 *   - All ID mappings (both user-defined and server-assigned)
 *   - Which Phase 1 resource types have been fully completed
 *   - Which Phase 2 Encounter IDs have been successfully uploaded
 */

import {
  BaseDirectory,
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
  readDir,
  remove,
} from '@tauri-apps/plugin-fs';
import type { MigrationCheckpoint, CheckpointSummary, MigrationCheckpoint as CP } from '../types/migration';
import type { FhirResourceType } from '../types/fhir';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHECKPOINT_DIR = 'checkpoints';
const BASE_DIR = BaseDirectory.AppLocalData;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ensure the checkpoints directory exists (idempotent).
 * Called once at migration start.
 */
async function ensureDir(): Promise<void> {
  const dirExists = await exists(CHECKPOINT_DIR, { baseDir: BASE_DIR });
  if (!dirExists) {
    await mkdir(CHECKPOINT_DIR, { baseDir: BASE_DIR, recursive: true });
  }
}

function filename(jobId: string): string {
  return `${CHECKPOINT_DIR}/${jobId}.json`;
}

/**
 * Save (create or overwrite) a checkpoint to disk.
 * This is called after every successful bundle upload — failure to save is
 * logged as a warning but does NOT abort the migration.
 */
export async function saveCheckpoint(checkpoint: MigrationCheckpoint): Promise<void> {
  try {
    await ensureDir();
    const json = JSON.stringify(checkpoint, null, 2);
    await writeTextFile(filename(checkpoint.jobId), json, { baseDir: BASE_DIR });
  } catch (err) {
    // Non-fatal — migration continues even if checkpoint write fails
    console.warn('[CheckpointService] Failed to save checkpoint:', err);
  }
}

/**
 * Load a checkpoint from disk by job ID.
 * Returns null if the file does not exist or cannot be parsed.
 */
export async function loadCheckpoint(jobId: string): Promise<MigrationCheckpoint | null> {
  try {
    const fileExists = await exists(filename(jobId), { baseDir: BASE_DIR });
    if (!fileExists) return null;

    const json = await readTextFile(filename(jobId), { baseDir: BASE_DIR });
    const parsed = JSON.parse(json) as MigrationCheckpoint;

    // Basic version guard
    if (parsed.version !== 1) {
      console.warn(`[CheckpointService] Checkpoint ${jobId} has unknown version ${parsed.version}`);
      return null;
    }

    return parsed;
  } catch (err) {
    console.warn('[CheckpointService] Failed to load checkpoint:', err);
    return null;
  }
}

/**
 * List all checkpoints that are NOT yet in "done" state.
 * Used by the UI to show "Resume Migration" options.
 */
export async function listIncompleteCheckpoints(): Promise<CheckpointSummary[]> {
  try {
    await ensureDir();
    const entries = await readDir(CHECKPOINT_DIR, { baseDir: BASE_DIR });
    const summaries: CheckpointSummary[] = [];

    for (const entry of entries) {
      if (!entry.name?.endsWith('.json')) continue;

      try {
        const json = await readTextFile(`${CHECKPOINT_DIR}/${entry.name}`, { baseDir: BASE_DIR });
        const cp = JSON.parse(json) as MigrationCheckpoint;

        if (cp.phase === 'done') continue; // already finished

        summaries.push({
          jobId: cp.jobId,
          startedAt: cp.startedAt,
          sourceUrl: cp.sourceUrl,
          targetUrl: cp.targetUrl,
          phase: cp.phase,
          completedPhase1Types: cp.phase1.completedResourceTypes.length,
          completedEncounters: cp.phase2.completedEncounterIds.length,
          totalMappings: Object.keys(cp.idMappings).length,
        });
      } catch {
        // Skip corrupted files
      }
    }

    // Sort newest first
    return summaries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  } catch {
    return [];
  }
}

/**
 * Delete a checkpoint file from disk.
 * Called when migration completes successfully.
 */
export async function deleteCheckpoint(jobId: string): Promise<void> {
  try {
    const fileExists = await exists(filename(jobId), { baseDir: BASE_DIR });
    if (fileExists) {
      await remove(filename(jobId), { baseDir: BASE_DIR });
    }
  } catch (err) {
    console.warn('[CheckpointService] Failed to delete checkpoint:', err);
  }
}

// ---------------------------------------------------------------------------
// Checkpoint mutation helpers (pure functions — return new checkpoint object)
// ---------------------------------------------------------------------------

/** Create a fresh checkpoint for a new migration job. */
export function createCheckpoint(
  jobId: string,
  sourceUrl: string,
  targetUrl: string,
  userDefinedMappings: Record<string, string> = {},
): MigrationCheckpoint {
  return {
    version: 1,
    jobId,
    startedAt: new Date().toISOString(),
    sourceUrl,
    targetUrl,
    phase: 'phase1',
    phase1: {
      completedResourceTypes: [],
      patientLinkPatched: false,
    },
    phase2: {
      completedEncounterIds: [],
    },
    idMappings: { ...userDefinedMappings },
  };
}

/** Add new server-assigned ID mappings to the checkpoint and return updated copy. */
export function checkpointWithMappings(
  checkpoint: MigrationCheckpoint,
  newMappings: Record<string, string>,
): MigrationCheckpoint {
  return {
    ...checkpoint,
    idMappings: { ...checkpoint.idMappings, ...newMappings },
  };
}

/** Mark a Phase 1 resource type as fully completed. */
export function checkpointWithPhase1Type(
  checkpoint: MigrationCheckpoint,
  resourceType: FhirResourceType,
): MigrationCheckpoint {
  if (checkpoint.phase1.completedResourceTypes.includes(resourceType)) return checkpoint;
  return {
    ...checkpoint,
    phase1: {
      ...checkpoint.phase1,
      completedResourceTypes: [...checkpoint.phase1.completedResourceTypes, resourceType],
    },
  };
}

/** Mark Phase 1b (Patient.link.other patching) as completed. */
export function checkpointWithPatientLinkPatched(checkpoint: MigrationCheckpoint): MigrationCheckpoint {
  return {
    ...checkpoint,
    phase: 'phase2',
    phase1: { ...checkpoint.phase1, patientLinkPatched: true },
  };
}

/** Mark an Encounter as successfully uploaded in Phase 2. */
export function checkpointWithEncounter(
  checkpoint: MigrationCheckpoint,
  encounterId: string,
): MigrationCheckpoint {
  if (checkpoint.phase2.completedEncounterIds.includes(encounterId)) return checkpoint;
  return {
    ...checkpoint,
    phase2: {
      completedEncounterIds: [...checkpoint.phase2.completedEncounterIds, encounterId],
    },
  };
}

/** Mark the migration as fully done. */
export function checkpointAsDone(checkpoint: MigrationCheckpoint): MigrationCheckpoint {
  return { ...checkpoint, phase: 'done' };
}

// ---------------------------------------------------------------------------
// Resume helpers
// ---------------------------------------------------------------------------

/** True if a Phase 1 resource type has already been fully completed. */
export function isPhase1TypeComplete(cp: CP, resourceType: FhirResourceType): boolean {
  return cp.phase1.completedResourceTypes.includes(resourceType);
}

/** True if an Encounter has already been successfully uploaded. */
export function isEncounterComplete(cp: CP, encounterId: string): boolean {
  return cp.phase2.completedEncounterIds.includes(encounterId);
}
