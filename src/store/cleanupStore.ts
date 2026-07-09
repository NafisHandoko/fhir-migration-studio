/**
 * Cleanup store — manages the active cleanup job, selected parameters, and progress.
 */

import { create } from 'zustand';
import type { FhirResourceType } from '../types/fhir';

export interface CleanupResourceProgress {
  total: number;      // estimated matching resources
  deleted: number;    // actually deleted
  failed: number;     // failed to delete
}

export type CleanupStatus = 'idle' | 'scanning' | 'confirming' | 'deleting' | 'done' | 'error' | 'cancelled';

export interface CleanupJob {
  id: string;
  status: CleanupStatus;
  isDryRun: boolean;
  selectedTypes: FhirResourceType[];
  dateFrom?: string;
  dateTo?: string;
  initiatorComponent: string;
  progress: Record<string, CleanupResourceProgress>;
  totals: {
    total: number;
    deleted: number;
    failed: number;
  };
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

interface CleanupState {
  current: CleanupJob | null;
  setJob: (job: CleanupJob) => void;
  updateStatus: (status: CleanupStatus) => void;
  updateResourceProgress: (resourceType: string, progress: Partial<CleanupResourceProgress>) => void;
  setError: (error: string) => void;
  completeJob: () => void;
  clearCurrent: () => void;
}

export const useCleanupStore = create<CleanupState>()((set) => ({
  current: null,

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
        deleted: 0,
        failed: 0,
      };
      const updated = { ...existing, ...progress };
      const allProgress = { ...s.current.progress, [resourceType]: updated };

      // Recalculate totals
      const totals = Object.values(allProgress).reduce(
        (acc, p) => ({
          total: acc.total + p.total,
          deleted: acc.deleted + p.deleted,
          failed: acc.failed + p.failed,
        }),
        { total: 0, deleted: 0, failed: 0 }
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
      return {
        current: {
          ...s.current,
          status: 'done',
          completedAt: new Date().toISOString(),
        },
      };
    }),

  clearCurrent: () => set({ current: null }),
}));
