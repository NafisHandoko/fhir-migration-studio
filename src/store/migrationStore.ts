/**
 * Migration store — manages the active migration job and history.
 */

import { create } from 'zustand';
import type { MigrationJob, MigrationStatus, ResourceProgress } from '../types/migration';
import type { FhirResourceType } from '../types/fhir';

interface MigrationState {
  current: MigrationJob | null;
  history: MigrationJob[];

  setJob: (job: MigrationJob) => void;
  updateStatus: (status: MigrationStatus) => void;
  updateResourceProgress: (resourceType: FhirResourceType, progress: Partial<ResourceProgress>) => void;
  setError: (error: string) => void;
  completeJob: () => void;
  clearCurrent: () => void;
}

export const useMigrationStore = create<MigrationState>()((set) => ({
  current: null,
  history: [],

  setJob: (job) => set({ current: job }),

  updateStatus: (status) =>
    set((s) =>
      s.current
        ? { current: { ...s.current, status } }
        : s,
    ),

  updateResourceProgress: (resourceType, progress) =>
    set((s) => {
      if (!s.current) return s;
      const existing = s.current.progress[resourceType] ?? {
        total: 0,
        downloaded: 0,
        uploaded: 0,
        failed: 0,
        skipped: 0,
      };
      const updated = { ...existing, ...progress };
      const allProgress = { ...s.current.progress, [resourceType]: updated };

      // Recalculate totals
      const totals = Object.values(allProgress).reduce(
        (acc, p) => ({
          total: acc.total + p.total,
          downloaded: acc.downloaded + p.downloaded,
          uploaded: acc.uploaded + p.uploaded,
          failed: acc.failed + p.failed,
          skipped: acc.skipped + p.skipped,
        }),
        { total: 0, downloaded: 0, uploaded: 0, failed: 0, skipped: 0 },
      );

      return {
        current: {
          ...s.current,
          progress: allProgress,
          totals,
        },
      };
    }),

  setError: (error) =>
    set((s) =>
      s.current
        ? { current: { ...s.current, status: 'error', error } }
        : s,
    ),

  completeJob: () =>
    set((s) => {
      if (!s.current) return s;
      const completed: MigrationJob = {
        ...s.current,
        status: 'done',
        completedAt: new Date().toISOString(),
      };
      return {
        current: completed,
        history: [completed, ...s.history].slice(0, 50), // keep last 50
      };
    }),

  clearCurrent: () => set({ current: null }),
}));
