import { useState, useMemo } from 'react';
import { Search, Trash2, Download } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { useLogStore, type LogLevel } from '../store/logStore';
import { MIGRATABLE_RESOURCE_TYPES, type FhirResourceType } from '../types/fhir';

const LEVEL_BADGE: Record<LogLevel, 'success' | 'error' | 'warning' | 'primary' | 'muted'> = {
  success: 'success',
  error: 'error',
  warn: 'warning',
  info: 'primary',
};

export function Logs() {
  const { entries, clearLogs } = useLogStore();
  const [levelFilter, setLevelFilter] = useState<LogLevel | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<FhirResourceType | 'all'>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (levelFilter !== 'all' && e.level !== levelFilter) return false;
      if (typeFilter !== 'all' && e.resourceType !== typeFilter) return false;
      if (search && !e.message.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [entries, levelFilter, typeFilter, search]);

  const handleExport = () => {
    const header = 'timestamp,level,resourceType,resourceId,message\n';
    const rows = filtered
      .map((e) =>
        [e.timestamp, e.level, e.resourceType ?? '', e.resourceId ?? '', `"${e.message.replace(/"/g, '""')}"`].join(','),
      )
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `migration-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%' }}>
      <Topbar
        title="Migration Logs"
        subtitle={`${entries.length.toLocaleString()} total entries`}
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              icon={<Download size={13} />}
              disabled={filtered.length === 0}
              onClick={handleExport}
            >
              Export CSV
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<Trash2 size={13} />}
              disabled={entries.length === 0}
              onClick={clearLogs}
            >
              Clear
            </Button>
          </>
        }
      />

      {/* Filters */}
      <div className="card" style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-subtle)' }} />
            <input
              className="input"
              style={{ paddingLeft: 30 }}
              placeholder="Search messages..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select
            className="select"
            style={{ width: 130 }}
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value as LogLevel | 'all')}
          >
            <option value="all">All Levels</option>
            <option value="info">Info</option>
            <option value="success">Success</option>
            <option value="warn">Warning</option>
            <option value="error">Error</option>
          </select>

          <select
            className="select"
            style={{ width: 170 }}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as FhirResourceType | 'all')}
          >
            <option value="all">All Resource Types</option>
            {MIGRATABLE_RESOURCE_TYPES.map((rt) => (
              <option key={rt} value={rt}>{rt}</option>
            ))}
          </select>

          <span style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
            {filtered.length.toLocaleString()} entries
          </span>
        </div>
      </div>

      {/* Log table */}
      <div className="card" style={{ padding: 0, flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">No log entries</div>
            <div className="empty-state-desc">
              {entries.length > 0 ? 'No entries match the current filter.' : 'Run a migration to see logs here.'}
            </div>
          </div>
        ) : (
          <div style={{ overflow: 'auto', flex: 1 }}>
            <table className="table" style={{ tableLayout: 'fixed' }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                <tr>
                  <th style={{ width: 80 }}>Level</th>
                  <th style={{ width: 80 }}>Time</th>
                  <th style={{ width: 140 }}>Resource Type</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <Badge variant={LEVEL_BADGE[entry.level]}>
                        {entry.level.toUpperCase()}
                      </Badge>
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                      {entry.resourceType ?? '—'}
                      {entry.resourceId && (
                        <span className="text-subtle text-mono" style={{ fontSize: 10, display: 'block' }}>
                          /{entry.resourceId}
                        </span>
                      )}
                    </td>
                    <td>
                      <div style={{ fontSize: 12, color: 'var(--color-text)' }}>{entry.message}</div>
                      {entry.detail && (
                        <div style={{ fontSize: 10, color: 'var(--color-text-subtle)', marginTop: 2, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {entry.detail}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
