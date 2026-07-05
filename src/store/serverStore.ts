/**
 * Server store — manages source and target server configurations and connection status.
 * Persisted to localStorage.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ServerConfig, ConnectionStatus } from '../types/server';
import { createDefaultServerConfig } from '../types/server';

interface ServerState {
  source: ServerConfig;
  target: ServerConfig;
  sourceStatus: ConnectionStatus;
  targetStatus: ConnectionStatus;

  setSource: (config: Partial<ServerConfig>) => void;
  setTarget: (config: Partial<ServerConfig>) => void;
  setSourceStatus: (status: Partial<ConnectionStatus>) => void;
  setTargetStatus: (status: Partial<ConnectionStatus>) => void;
  resetSourceStatus: () => void;
  resetTargetStatus: () => void;
}

const defaultStatus: ConnectionStatus = { state: 'idle' };

export const useServerStore = create<ServerState>()(
  persist(
    (set) => ({
      source: createDefaultServerConfig('source'),
      target: createDefaultServerConfig('target'),
      sourceStatus: defaultStatus,
      targetStatus: defaultStatus,

      setSource: (config) =>
        set((s) => ({ source: { ...s.source, ...config } })),

      setTarget: (config) =>
        set((s) => ({ target: { ...s.target, ...config } })),

      setSourceStatus: (status) =>
        set((s) => ({ sourceStatus: { ...s.sourceStatus, ...status } })),

      setTargetStatus: (status) =>
        set((s) => ({ targetStatus: { ...s.targetStatus, ...status } })),

      resetSourceStatus: () => set({ sourceStatus: defaultStatus }),
      resetTargetStatus: () => set({ targetStatus: defaultStatus }),
    }),
    {
      name: 'fhir-ms-servers',
      // Don't persist connection status — always re-test on start
      partialize: (s) => ({ source: s.source, target: s.target }),
    },
  ),
);
