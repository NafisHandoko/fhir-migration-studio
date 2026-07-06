import { create } from 'zustand';
import type { FhirResourceType, FhirResource } from '../types/fhir';
import { MIGRATABLE_RESOURCE_TYPES } from '../types/fhir';
import { downloadResourceType } from '../services/downloader';
import type { ServerConfig } from '../types/server';
import { log } from './logStore';

export interface ResourceDownloadState {
  total: number;
  downloaded: number;
  status: 'idle' | 'running' | 'done' | 'error';
  error?: string;
}

interface ExportState {
  running: boolean;
  selected: FhirResourceType[];
  progress: Partial<Record<FhirResourceType, ResourceDownloadState>>;
  isCancelled: boolean;
  hasFinished: boolean;
  totalExportedCount: number;

  toggleResource: (rt: FhirResourceType) => void;
  selectAll: () => void;
  selectNone: () => void;
  startExport: (source: ServerConfig) => Promise<void>;
  cancelExport: () => void;
  reset: () => void;
}

export const useExportStore = create<ExportState>()((set, get) => ({
  running: false,
  selected: [...MIGRATABLE_RESOURCE_TYPES],
  progress: {},
  isCancelled: false,
  hasFinished: false,
  totalExportedCount: 0,

  toggleResource: (rt) =>
    set((s) => {
      if (s.running) return s;
      const index = s.selected.indexOf(rt);
      const nextSelected = [...s.selected];
      if (index > -1) {
        nextSelected.splice(index, 1);
      } else {
        nextSelected.push(rt);
      }
      return { selected: nextSelected };
    }),

  selectAll: () =>
    set((s) => (s.running ? s : { selected: [...MIGRATABLE_RESOURCE_TYPES] })),

  selectNone: () =>
    set((s) => (s.running ? s : { selected: [] })),

  startExport: async (source) => {
    const { selected, running } = get();
    if (running || selected.length === 0 || !source.baseUrl) return;

    set({
      running: true,
      isCancelled: false,
      hasFinished: false,
      progress: {},
      totalExportedCount: 0,
    });

    log({ level: 'info', message: 'Starting NDJSON export process...' });
    const allResources: FhirResource[] = [];

    for (const rt of selected) {
      if (get().isCancelled) break;

      set((s) => ({
        progress: {
          ...s.progress,
          [rt]: { total: 0, downloaded: 0, status: 'running' },
        },
      }));

      try {
        const resources = await downloadResourceType(source, rt, {
          onPage: (_page, downloaded, total) => {
            set((s) => ({
              progress: {
                ...s.progress,
                [rt]: { total, downloaded, status: 'running' },
              },
            }));
          },
          shouldContinue: () => !get().isCancelled,
        });

        if (get().isCancelled) {
          set((s) => ({
            progress: {
              ...s.progress,
              [rt]: { total: 0, downloaded: 0, status: 'idle' },
            },
          }));
          break;
        }

        allResources.push(...resources);
        set((s) => ({
          progress: {
            ...s.progress,
            [rt]: { total: resources.length, downloaded: resources.length, status: 'done' },
          },
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        set((s) => ({
          progress: {
            ...s.progress,
            [rt]: { total: 0, downloaded: 0, status: 'error', error: msg },
          },
        }));
      }
    }

    if (get().isCancelled) {
      log({ level: 'warn', message: 'NDJSON export cancelled by user.' });
      set({ running: false });
      return;
    }

    try {
      if (allResources.length > 0) {
        const ndjson = allResources.map((r) => JSON.stringify(r)).join('\n');
        const blob = new Blob([ndjson], { type: 'application/x-ndjson' });
        const url = URL.createObjectURL(blob);
        const filename = `fhir-export-${new Date().toISOString().slice(0, 10)}.ndjson`;
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        
        log({ level: 'success', message: `Export complete. ${allResources.length} resources downloaded.` });
        set({ hasFinished: true, totalExportedCount: allResources.length });
      } else {
        log({ level: 'warn', message: 'No resources found to export.' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log({ level: 'error', message: `Failed to compile NDJSON download file: ${msg}` });
    } finally {
      set({ running: false });
    }
  },

  cancelExport: () => {
    set({ isCancelled: true, running: false });
  },

  reset: () => {
    set({
      running: false,
      progress: {},
      isCancelled: false,
      hasFinished: false,
      totalExportedCount: 0,
    });
  },
}));
