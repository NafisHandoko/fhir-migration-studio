/**
 * Mapping store — manages reference remapping rules.
 * Persisted to localStorage.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MappingRule } from '../types/mapping';

interface MappingState {
  rules: MappingRule[];
  addRule: (rule: MappingRule) => void;
  updateRule: (id: string, patch: Partial<MappingRule>) => void;
  removeRule: (id: string) => void;
  clearRules: () => void;
  importRules: (rules: MappingRule[]) => void;
}

export const useMappingStore = create<MappingState>()(
  persist(
    (set) => ({
      rules: [],

      addRule: (rule) =>
        set((s) => ({ rules: [...s.rules, rule] })),

      updateRule: (id, patch) =>
        set((s) => ({
          rules: s.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        })),

      removeRule: (id) =>
        set((s) => ({ rules: s.rules.filter((r) => r.id !== id) })),

      clearRules: () => set({ rules: [] }),

      importRules: (incoming) =>
        set((s) => {
          // Merge: deduplicate by resourceType + sourceId, incoming wins
          const existingMap = new Map(
            s.rules.map((r) => [`${r.resourceType}/${r.sourceId}`, r]),
          );
          for (const r of incoming) {
            existingMap.set(`${r.resourceType}/${r.sourceId}`, r);
          }
          return { rules: Array.from(existingMap.values()) };
        }),
    }),
    { name: 'fhir-ms-mappings' },
  ),
);
