import type { ConnectionState } from '../../types/server';

interface StatusDotProps {
  state: ConnectionState;
  showLabel?: boolean;
}

const labels: Record<ConnectionState, string> = {
  idle: 'Not tested',
  testing: 'Testing...',
  connected: 'Connected',
  error: 'Error',
};

const colors: Record<ConnectionState, string> = {
  idle: 'var(--color-text-subtle)',
  testing: 'var(--color-warning)',
  connected: 'var(--color-success)',
  error: 'var(--color-error)',
};

export function StatusDot({ state, showLabel = false }: StatusDotProps) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        className={`status-dot ${state}`}
        style={{ backgroundColor: colors[state] }}
      />
      {showLabel && (
        <span style={{ fontSize: 11, color: colors[state], fontWeight: 500 }}>
          {labels[state]}
        </span>
      )}
    </span>
  );
}
