import { useState } from 'react';
import { Wifi, Edit2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { StatusDot } from '../ui/StatusDot';
import { useServerStore } from '../../store/serverStore';
import { fhirClient } from '../../services/fhirClient';
import type { ServerRole } from '../../types/server';

interface ServerCardProps {
  role: ServerRole;
  onEdit?: () => void;
}

export function ServerCard({ role, onEdit }: ServerCardProps) {
  const { source, target, sourceStatus, targetStatus, setSourceStatus, setTargetStatus } =
    useServerStore();

  const config = role === 'source' ? source : target;
  const status = role === 'source' ? sourceStatus : targetStatus;
  const setStatus = role === 'source' ? setSourceStatus : setTargetStatus;

  const [testing, setTesting] = useState(false);

  async function handleTest() {
    if (!config.baseUrl) return;
    setTesting(true);
    setStatus({ state: 'testing', error: undefined });
    try {
      const cs = await fhirClient.testConnection(config);
      setStatus({
        state: 'connected',
        fhirVersion: cs.fhirVersion,
        serverName: cs.software?.name,
        testedAt: new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus({ state: 'error', error: msg });
    } finally {
      setTesting(false);
    }
  }

  const label = role === 'source' ? 'Source Server' : 'Target Server';

  return (
    <div className="server-card">
      <div className="server-card-header">
        <div className="server-card-name">
          <StatusDot state={status.state} />
          {label}
        </div>
        {onEdit && (
          <Button variant="ghost" size="icon" onClick={onEdit} title="Edit server config">
            <Edit2 size={13} />
          </Button>
        )}
      </div>

      {config.baseUrl ? (
        <>
          <div className="server-card-url">{config.baseUrl}</div>
          <div className="server-card-meta">
            {status.fhirVersion && <span>FHIR {status.fhirVersion}</span>}
            {config.auth?.token && <span>Auth: Bearer</span>}
            {config.tenantId && <span>Tenant: {config.tenantId}</span>}
            {status.state === 'connected' && status.testedAt && (
              <span className="text-success">Connected</span>
            )}
            {status.state === 'error' && (
              <span className="text-error" title={status.error}>
                {status.error?.slice(0, 60)}
              </span>
            )}
          </div>
        </>
      ) : (
        <div className="server-card-url text-subtle">Not configured</div>
      )}

      <div style={{ marginTop: 10 }}>
        <Button
          variant="secondary"
          size="sm"
          icon={<Wifi size={13} />}
          loading={testing}
          disabled={!config.baseUrl || testing}
          onClick={handleTest}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          Test Connection
        </Button>
      </div>
    </div>
  );
}
