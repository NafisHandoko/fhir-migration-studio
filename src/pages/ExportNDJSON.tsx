import { Download, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ProgressBar } from '../components/ui/ProgressBar';
import { ServerCard } from '../components/server/ServerCard';
import { useServerStore } from '../store/serverStore';
import { useExportStore } from '../store/exportStore';
import { MIGRATABLE_RESOURCE_TYPES } from '../types/fhir';

export function ExportNDJSON() {
  const { source } = useServerStore();
  const {
    running,
    selected,
    progress,
    toggleResource,
    selectAll,
    selectNone,
    startExport,
    cancelExport,
    reset,
    hasFinished,
    totalExportedCount,
  } = useExportStore();

  const handleExport = () => {
    startExport(source);
  };

  const toggleAll = () => {
    if (selected.length === MIGRATABLE_RESOURCE_TYPES.length) {
      selectNone();
    } else {
      selectAll();
    }
  };

  const totalDownloaded = Object.values(progress).reduce((s, p) => s + (p?.downloaded ?? 0), 0);
  const hasProgress = Object.keys(progress).length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 800 }}>
      <Topbar
        title="Export to NDJSON"
        subtitle="Download FHIR resources from source server as NDJSON file"
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            {running && (
              <Button
                variant="danger"
                size="sm"
                icon={<XCircle size={13} />}
                onClick={cancelExport}
              >
                Batal
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              icon={<Download size={13} />}
              loading={running}
              disabled={running || !source.baseUrl || selected.length === 0}
              onClick={handleExport}
            >
              Export & Download
            </Button>
          </div>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {!source.baseUrl && (
            <div className="alert alert-warning">
              <AlertTriangle size={15} />
              Configure the source server in Settings first.
            </div>
          )}

          <Card title="Resource Types to Export">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <label className="checkbox-group">
                <input
                  type="checkbox"
                  checked={selected.length === MIGRATABLE_RESOURCE_TYPES.length}
                  onChange={toggleAll}
                  disabled={running}
                />
                <span className="checkbox-label" style={{ fontWeight: 600 }}>Select All</span>
              </label>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                ({selected.length} of {MIGRATABLE_RESOURCE_TYPES.length} selected)
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {MIGRATABLE_RESOURCE_TYPES.map((rt) => {
                const isSelected = selected.includes(rt);
                const p = progress[rt];
                return (
                  <label
                    key={rt}
                    className="checkbox-group"
                    style={{
                      padding: '6px 8px',
                      borderRadius: 4,
                      border: '1px solid',
                      borderColor: isSelected ? 'var(--color-primary)' : 'var(--color-border)',
                      backgroundColor: isSelected ? 'var(--color-primary-muted)' : 'transparent',
                      cursor: running ? 'not-allowed' : 'pointer',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => !running && toggleResource(rt)}
                        disabled={running}
                      />
                      <span className="checkbox-label">{rt}</span>
                      {p?.status === 'done' && <CheckCircle2 size={12} style={{ color: 'var(--color-success)' }} />}
                    </div>
                    {p && p.status !== 'idle' && (
                      <div style={{ marginTop: 4, width: '100%' }}>
                        <ProgressBar
                          value={p.total > 0 ? Math.round((p.downloaded / p.total) * 100) : p.status === 'done' ? 100 : 0}
                          height={2}
                          variant={p.status === 'error' ? 'error' : p.status === 'done' ? 'success' : 'default'}
                        />
                        {p.status !== 'error' && (
                          <div style={{ fontSize: 10, color: 'var(--color-text-subtle)', marginTop: 2 }}>
                            {p.downloaded}/{p.total}
                          </div>
                        )}
                        {p.status === 'error' && (
                          <div style={{ fontSize: 10, color: 'var(--color-error)', marginTop: 2 }} title={p.error}>
                            Error
                          </div>
                        )}
                      </div>
                    )}
                  </label>
                );
              })}
            </div>
          </Card>

          {hasProgress && (
            <div className={`alert ${running ? 'alert-info' : 'alert-success'}`}>
              {running ? (
                <span>Downloading... {totalDownloaded.toLocaleString()} resources fetched</span>
              ) : hasFinished ? (
                <>
                  <CheckCircle2 size={15} />
                  <span>Export complete. {totalExportedCount.toLocaleString()} resources downloaded.</span>
                </>
              ) : (
                <span>Export stopped. Ready for next operation.</span>
              )}
            </div>
          )}

          {!running && hasProgress && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="ghost" size="sm" onClick={reset}>
                Reset Progress View
              </Button>
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Source Server
          </div>
          <ServerCard role="source" />

          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-title">Output Format</div>
            <div style={{ fontSize: 13, color: 'var(--color-text)' }}>NDJSON</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
              One JSON resource per line. Compatible with standard FHIR bulk data tools.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
