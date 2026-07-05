import type { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  title?: string;
  style?: React.CSSProperties;
}

export function Card({ children, className = '', size = 'md', title, style }: CardProps) {
  const sizeClass = size === 'md' ? '' : `card-${size}`;
  return (
    <div className={`card ${sizeClass} ${className}`.trim()} style={style}>
      {title && <div className="card-title">{title}</div>}
      {children}
    </div>
  );
}

interface StatCardProps {
  icon: ReactNode;
  iconBg: string;
  value: string | number;
  label: string;
  sub?: string;
  valueColor?: string;
}

export function StatCard({ icon, iconBg, value, label, sub, valueColor }: StatCardProps) {
  return (
    <div className="stat-card">
      <div className="stat-icon" style={{ backgroundColor: iconBg }}>
        {icon}
      </div>
      <div>
        <div className="stat-value" style={valueColor ? { color: valueColor } : undefined}>
          {typeof value === 'number' ? value.toLocaleString() : value}
        </div>
        <div className="stat-label">{label}</div>
        {sub && <div className="stat-sub">{sub}</div>}
      </div>
    </div>
  );
}
