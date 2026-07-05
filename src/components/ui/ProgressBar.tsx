interface ProgressBarProps {
  value: number; // 0–100
  variant?: 'default' | 'success' | 'error';
  height?: number;
  showLabel?: boolean;
  animated?: boolean;
}

export function ProgressBar({
  value,
  variant = 'default',
  height = 4,
  showLabel = false,
  animated = true,
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const fillClass = variant === 'default' ? '' : variant;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div className="progress-bar" style={{ flex: 1, height }}>
        <div
          className={`progress-bar-fill ${fillClass}`}
          style={{
            width: `${clamped}%`,
            transition: animated ? 'width 300ms ease' : 'none',
          }}
        />
      </div>
      {showLabel && (
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', minWidth: 34, textAlign: 'right' }}>
          {clamped}%
        </span>
      )}
    </div>
  );
}
