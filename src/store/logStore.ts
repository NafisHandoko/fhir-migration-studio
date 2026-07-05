/**
 * Log store — append-only activity log for migration operations.
 */

import { create } from 'zustand';
import type { FhirResourceType } from '../types/fhir';

export type LogLevel = 'info' | 'warn' | 'error' | 'success';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  resourceType?: FhirResourceType;
  resourceId?: string;
  jobId?: string;
  detail?: string;
}

interface LogState {
  entries: LogEntry[];
  addLog: (entry: Omit<LogEntry, 'id' | 'timestamp'>) => void;
  clearLogs: () => void;
}

let logSeq = 0;

export const useLogStore = create<LogState>()((set) => ({
  entries: [],

  addLog: (entry) =>
    set((s) => {
      const log: LogEntry = {
        ...entry,
        id: `log-${++logSeq}`,
        timestamp: new Date().toISOString(),
      };
      // Keep last 2000 entries
      const entries = [log, ...s.entries].slice(0, 2000);
      return { entries };
    }),

  clearLogs: () => set({ entries: [] }),
}));

/** Convenience helper — use outside React */
export function log(entry: Omit<LogEntry, 'id' | 'timestamp'>): void {
  useLogStore.getState().addLog(entry);
}
