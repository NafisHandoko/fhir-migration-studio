/**
 * Settings store — manages global transaction bundle limits.
 * Persisted to localStorage.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface SettingsState {
  maxBundleResourceCount: number;
  maxBundleRequestSizeMb: number;

  setMaxBundleResourceCount: (count: number) => void;
  setMaxBundleRequestSizeMb: (size: number) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      maxBundleResourceCount: 100,
      maxBundleRequestSizeMb: 3,

      setMaxBundleResourceCount: (count) => set({ maxBundleResourceCount: count }),
      setMaxBundleRequestSizeMb: (size) => set({ maxBundleRequestSizeMb: size }),
    }),
    {
      name: 'fhir-ms-settings',
    },
  ),
);
