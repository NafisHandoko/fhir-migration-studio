import { useState } from 'react';
import { Download, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ProgressBar } from '../components/ui/ProgressBar';
import { ServerCard } from '../components/server/ServerCard';
import { useServerStore } from '../store/serverStore';
import { downloadResourceType } from '../services/downloader';
import { MIGRATABLE_RESOURCE_TYPES, type FhirResourceType, type FhirResource } from '../types/fhir';

interface ResourceDownloadState {
  total: number;
  downloaded: number;
  status: 'idle' | 'running' | 'done' | 'error';
  error?: string;
}

export function ExportNDJSON() {
  const { source } = useServerStore();
  const [selected, setSelected] = useState<Set<FhirResourceType>>(
    new Set(MIGRATABLE_RESOURCE_TYPES),
  );
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Partial<Record<FhirResourceType, ResourceDownloadState>>>({});

  const toggleResource = (rt: FhirResourceType) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rt)) next.delete(rt);
      else next.add(rt);
      return next;
    });
  };

  const handleExport = async () => {
    if (!source.baseUrl) return;
    setRunning(true);

    const allResources: FhirResource[] = [];

    for (const rt of Array.from(selected)) {
      setProgress((p) => ({
        ...p,
        [rt]: { total: 0, downloaded: 0, status: 'running' },
      }));

      try {
        const resources = await downloadResourceType(source, rt, {
          onPage: (_page, downloaded, total) => {
            setProgress((p) => ({
              ...p,
              [rt]: { total, downloaded, status: 'running' },
            }));
          },
        });

        allResources.push(...resources);
        setProgress((p) => ({
          ...p,
          [rt]: { total: resources.length, downloaded: resources.length, status: 'done' },
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setProgress((p) => ({
          ...p,
          [rt]: { total: 0, downloaded: 0, status: 'error', error: msg },
        }));
      }
    }

    // Build NDJSON
    const ndjson = allResources.map((r) => JSON.stringify(r)).join('\n');
    const blob = new Blob([ndjson], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const filename = `fhir-export-${new Date().toISOString().slice(0, 10)}.ndjson`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    setRunning(false);
  };

  const totalDownloaded = Object.values(progress).reduce((s, p) => s + (p?.downloaded ?? 0), 0);
  const hasProgress = Object.keys(progress).length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 800 }}>
      <Topbar
        title="Export to NDJSON"
        subtitle="Download FHIR resources from source server as NDJSON file"
        actions={
          <Button
            variant="primary"
            size="sm"
            icon={<Download size={13} />}
            loading={running}
            disabled={running || !source.baseUrl || selected.size === 0}
            onClick={handleExport}
          >
            Export & Download
          </Button>
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {MIGRATABLE_RESOURCE_TYPES.map((rt) => {
                const p = progress[rt];
                return (
                  <label
                    key={rt}
                    className="checkbox-group"
                    style={{
                      padding: '6px 8px',
                      borderRadius: 4,
                      border: '1px solid',
                      borderColor: selected.has(rt) ? 'var(--color-primary)' : 'var(--color-border)',
                      backgroundColor: selected.has(rt) ? 'var(--color-primary-muted)' : 'transparent',
                      cursor: running ? 'not-allowed' : 'pointer',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={selected.has(rt)}
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
              ) : (
                <>
                  <CheckCircle2 size={15} />
                  <span>Export complete. {totalDownloaded.toLocaleString()} resources downloaded.</span>
                </>
              )}
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
