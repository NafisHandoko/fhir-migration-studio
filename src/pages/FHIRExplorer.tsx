import { useState } from 'react';
import { Search, RefreshCw, Eye } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { ProgressBar } from '../components/ui/ProgressBar';
import { useServerStore } from '../store/serverStore';
import { fhirClient } from '../services/fhirClient';
import { MIGRATABLE_RESOURCE_TYPES, type FhirResourceType, type FhirResource, type Bundle } from '../types/fhir';
import type { ServerRole } from '../types/server';

export function FHIRExplorer() {
  const { source, target } = useServerStore();
  const [serverRole, setServerRole] = useState<ServerRole>('source');
  const [resourceType, setResourceType] = useState<FhirResourceType>('Patient');
  const [searchId, setSearchId] = useState('');
  const [results, setResults] = useState<FhirResource[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<FhirResource | null>(null);

  const config = serverRole === 'source' ? source : target;

  const handleSearch = async () => {
    if (!config.baseUrl) {
      setError('Server not configured.');
      return;
    }
    setLoading(true);
    setError('');

    try {
      let bundle: Bundle;
      if (searchId.trim()) {
        // Direct ID lookup
        const resource = await fhirClient.get<FhirResource>(config, `/${resourceType}/${searchId.trim()}`);
        setResults([resource]);
        setTotal(1);
      } else {
        bundle = await fhirClient.search(config, resourceType, { _count: '20' });
        const resources = (bundle.entry ?? [])
          .map((e) => e.resource)
          .filter((r): r is FhirResource => r !== undefined);
        setResults(resources);
        setTotal(bundle.total ?? resources.length);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const ALL_TYPES: FhirResourceType[] = [
    ...MIGRATABLE_RESOURCE_TYPES,
    'Practitioner',
    'Location',
    'HealthcareService',
    'Organization',
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 900 }}>
      <Topbar
        title="FHIR Explorer"
        subtitle="Browse and inspect FHIR resources on either server"
      />

      {/* Controls */}
      <div className="card">
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="input-group" style={{ minWidth: 140 }}>
            <label className="input-label">Server</label>
            <select
              className="select"
              value={serverRole}
              onChange={(e) => setServerRole(e.target.value as ServerRole)}
            >
              <option value="source">Source Server</option>
              <option value="target">Target Server</option>
            </select>
          </div>

          <div className="input-group" style={{ minWidth: 180 }}>
            <label className="input-label">Resource Type</label>
            <select
              className="select"
              value={resourceType}
              onChange={(e) => setResourceType(e.target.value as FhirResourceType)}
            >
              {ALL_TYPES.map((rt) => (
                <option key={rt} value={rt}>{rt}</option>
              ))}
            </select>
          </div>

          <div className="input-group" style={{ flex: 1, minWidth: 200 }}>
            <label className="input-label">Resource ID (optional)</label>
            <input
              className="input input-mono"
              placeholder="Leave blank to list all"
              value={searchId}
              onChange={(e) => setSearchId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
          </div>

          <Button
            variant="primary"
            size="md"
            icon={loading ? <RefreshCw size={14} className="spin" /> : <Search size={14} />}
            loading={loading}
            disabled={!config.baseUrl}
            onClick={handleSearch}
          >
            Search
          </Button>
        </div>

        {!config.baseUrl && (
          <div style={{ fontSize: 12, color: 'var(--color-warning)', marginTop: 8 }}>
            ⚠ {serverRole === 'source' ? 'Source' : 'Target'} server is not configured.
          </div>
        )}

        {error && (
          <div style={{ fontSize: 12, color: 'var(--color-error)', marginTop: 8 }}>
            Error: {error}
          </div>
        )}
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '12px 16px 8px', borderBottom: '1px solid var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>
              {resourceType} Resources
            </span>
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              Showing {results.length} of {total.toLocaleString()}
            </span>
          </div>
          <div className="table-wrapper" style={{ border: 'none', borderRadius: 0 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Identifiers</th>
                  <th>Last Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => {
                  const identifiers = (r.identifier as Array<{ system?: string; value?: string }> | undefined) ?? [];
                  return (
                    <tr key={r.id ?? Math.random()}>
                      <td>
                        <span className="text-mono" style={{ fontSize: 12 }}>{r.id ?? '—'}</span>
                      </td>
                      <td style={{ maxWidth: 220 }}>
                        {identifiers.slice(0, 2).map((id, i) => (
                          <div key={i} style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                            <span className="text-mono">{id.value}</span>
                            {id.system && <span style={{ color: 'var(--color-text-subtle)' }}> ({id.system.split('/').pop()})</span>}
                          </div>
                        ))}
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                        {r.meta?.lastUpdated ? new Date(r.meta.lastUpdated as string).toLocaleDateString() : '—'}
                      </td>
                      <td>
                        <Button variant="ghost" size="icon" onClick={() => setSelected(r)} title="View JSON">
                          <Eye size={13} />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loading && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--color-text-muted)', fontSize: 13 }}>
          <RefreshCw size={14} className="spin" />
          Loading resources...
          <ProgressBar value={0} animated />
        </div>
      )}

      {/* JSON viewer modal */}
      <Modal
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={`${selected?.resourceType}/${selected?.id}`}
        maxWidth={700}
      >
        <pre className="code-block">
          {selected ? JSON.stringify(selected, null, 2) : ''}
        </pre>
      </Modal>
    </div>
  );
}
