import { useRef } from 'react';
import { Upload, FileText, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ProgressBar } from '../components/ui/ProgressBar';
import { ServerCard } from '../components/server/ServerCard';
import { useServerStore } from '../store/serverStore';
import { useMappingStore } from '../store/mappingStore';
import { useImportStore, type ParsedFile } from '../store/importStore';
import type { FhirResource, FhirResourceType } from '../types/fhir';

function parseNDJSON(content: string): ParsedFile {
  const lines = content.split('\n').filter((l) => l.trim());
  const resources: FhirResource[] = [];
  const byType: Partial<Record<FhirResourceType, number>> = {};
  let errors = 0;

  for (const line of lines) {
    try {
      const r = JSON.parse(line) as FhirResource;
      resources.push(r);
      const rt = r.resourceType as FhirResourceType;
      byType[rt] = (byType[rt] ?? 0) + 1;
    } catch {
      errors++;
    }
  }

  return { resources, byType, lineCount: lines.length, errors };
}

export function ImportNDJSON() {
  const { target } = useServerStore();
  const { rules } = useMappingStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const {
    parsed,
    fileName,
    uploadState,
    setFile,
    startImport,
    cancelImport,
    reset,
  } = useImportStore();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = ev.target?.result as string;
      const result = parseNDJSON(content);
      setFile(file.name, result);
    };
    reader.readAsText(file);
  };

  const handleUpload = () => {
    startImport(target, rules);
  };

  const isUploading = uploadState.status === 'uploading';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 800 }}>
      <Topbar
        title="Import from NDJSON"
        subtitle="Upload a NDJSON file and send resources to the target server"
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            {isUploading && (
              <Button
                variant="danger"
                size="sm"
                icon={<XCircle size={13} />}
                onClick={cancelImport}
              >
                Batal
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              icon={<Upload size={13} />}
              disabled={!parsed || !target.baseUrl || isUploading}
              loading={isUploading}
              onClick={handleUpload}
            >
              Upload to Server
            </Button>
          </div>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* File picker */}
          <Card>
            <div className="card-title">Select NDJSON File</div>
            <div
              style={{
                border: '2px dashed var(--color-border)',
                borderRadius: 'var(--radius-lg)',
                padding: '32px 16px',
                textAlign: 'center',
                cursor: isUploading ? 'not-allowed' : 'pointer',
                transition: 'border-color 150ms',
              }}
              onClick={() => !isUploading && fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (isUploading) return;
                const file = e.dataTransfer.files[0];
                if (file && fileInputRef.current) {
                  const dt = new DataTransfer();
                  dt.items.add(file);
                  fileInputRef.current.files = dt.files;
                  fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
                }
              }}
            >
              <FileText size={32} style={{ color: 'var(--color-text-subtle)', margin: '0 auto 12px' }} />
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)' }}>
                {fileName || 'Drop NDJSON file here or click to browse'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-subtle)', marginTop: 4 }}>
                .ndjson files only
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".ndjson,.json"
                style={{ display: 'none' }}
                onChange={handleFileChange}
                disabled={isUploading}
              />
            </div>
          </Card>

          {/* Parsed preview */}
          {parsed && (
            <Card title="File Preview">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)' }}>{parsed.resources.length.toLocaleString()}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Total Resources</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)' }}>{Object.keys(parsed.byType).length}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Resource Types</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: parsed.errors > 0 ? 'var(--color-error)' : 'var(--color-success)' }}>
                    {parsed.errors}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Parse Errors</div>
                </div>
              </div>

              <div className="table-wrapper">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Resource Type</th>
                      <th>Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(parsed.byType).map(([rt, count]) => (
                      <tr key={rt}>
                        <td>{rt}</td>
                        <td>{count?.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Upload progress */}
          {uploadState.status !== 'idle' && (
            <Card>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                {uploadState.status === 'done' && <CheckCircle2 size={16} style={{ color: 'var(--color-success)' }} />}
                {uploadState.status === 'error' && <XCircle size={16} style={{ color: 'var(--color-error)' }} />}
                <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--color-text)' }}>
                  {uploadState.status === 'uploading' ? 'Uploading...' :
                   uploadState.status === 'done' ? 'Upload Complete' : 'Upload Failed'}
                </span>
              </div>
              <ProgressBar value={uploadState.progress} showLabel height={6} variant={uploadState.status === 'done' ? 'success' : 'default'} />
              <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12, color: 'var(--color-text-muted)' }}>
                <span className="text-success">✓ {uploadState.success.toLocaleString()}</span>
                <span className={uploadState.failed > 0 ? 'text-error' : ''}>✕ {uploadState.failed}</span>
              </div>
            </Card>
          )}

          {!isUploading && parsed && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="ghost" size="sm" onClick={reset}>
                Clear File Preview
              </Button>
            </div>
          )}

          {!target.baseUrl && (
            <div className="alert alert-warning">
              <AlertTriangle size={15} />
              Target server is not configured. Set it up in Settings.
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Target Server
          </div>
          <ServerCard role="target" />
          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-title">Mapping Rules</div>
            <div style={{ fontSize: 13, color: 'var(--color-text)' }}>{rules.length} rules active</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
              References will be rewritten before upload.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
