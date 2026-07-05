import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  ArrowRightLeft,
  Download,
  Upload,
  GitCompare,
  Search,
  FileText,
  Settings,
  Activity,
} from 'lucide-react';

interface NavItemDef {
  to: string;
  icon: React.ReactNode;
  label: string;
  badge?: string;
}

const navItems: NavItemDef[] = [
  { to: '/',              icon: <LayoutDashboard size={16} />, label: 'Dashboard' },
  { to: '/migrate',       icon: <ArrowRightLeft size={16} />,  label: 'Direct Migration', badge: 'NEW' },
  { to: '/export',        icon: <Download size={16} />,        label: 'Export to NDJSON' },
  { to: '/import',        icon: <Upload size={16} />,          label: 'Import from NDJSON' },
  { to: '/mapping',       icon: <GitCompare size={16} />,      label: 'Mapping' },
  { to: '/explorer',      icon: <Search size={16} />,          label: 'FHIR Explorer' },
  { to: '/logs',          icon: <Activity size={16} />,        label: 'Logs' },
  { to: '/settings',      icon: <Settings size={16} />,        label: 'Settings' },
];

export function Sidebar() {
  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">
          <FileText size={14} color="white" />
        </div>
        <div className="sidebar-logo-text">
          FHIR
          <div className="sidebar-logo-sub">Migration Studio</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <span className="nav-item-icon">{item.icon}</span>
            <span className="nav-item-label">{item.label}</span>
            {item.badge && (
              <span className="nav-item-badge">{item.badge}</span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <div className="sidebar-avatar">A</div>
        <div className="sidebar-user-info">
          <div className="sidebar-username">Engineer</div>
          <div className="sidebar-version">v0.1.0</div>
        </div>
      </div>
    </aside>
  );
}
