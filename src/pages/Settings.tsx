import { useState, useEffect } from 'react';
import { Save, Eye, EyeOff } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { ServerCard } from '../components/server/ServerCard';
import { useServerStore } from '../store/serverStore';
import type { ServerConfig } from '../types/server';

interface ServerFormProps {
  title: string;
  config: ServerConfig;
  onSave: (patch: Partial<ServerConfig>) => void;
}

function ServerForm({ title, config, onSave }: ServerFormProps) {
  const [url, setUrl] = useState(config.baseUrl);
  const [tenantId, setTenantId] = useState(config.tenantId ?? '');
  const [token, setToken] = useState(config.auth?.token ?? '');
  const [showToken, setShowToken] = useState(false);
  const [saved, setSaved] = useState(false);

  // Reset form when config changes from outside
  useEffect(() => {
    setUrl(config.baseUrl);
    setTenantId(config.tenantId ?? '');
    setToken(config.auth?.token ?? '');
  }, [config]);

  const handleSave = () => {
    onSave({
      baseUrl: url.trim(),
      tenantId: tenantId.trim() || undefined,
      auth: token.trim() ? { token: token.trim() } : undefined,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>{title}</div>
        <Button
          variant={saved ? 'success' : 'primary'}
          size="sm"
          icon={<Save size={13} />}
          onClick={handleSave}
        >
          {saved ? 'Saved!' : 'Save'}
        </Button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Input
          label="Server Base URL"
          placeholder="https://fhir-server.example.com/fhir"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          mono
          hint="The FHIR base URL including path (e.g., /fhir)"
        />

        <div className="input-group">
          <label className="input-label">
            Bearer Token (optional)
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              className="input input-mono"
              type={showToken ? 'text' : 'password'}
              placeholder="Leave empty for no authorization"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              style={{ flex: 1 }}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowToken((v) => !v)}
              title={showToken ? 'Hide token' : 'Show token'}
            >
              {showToken ? <EyeOff size={13} /> : <Eye size={13} />}
            </Button>
          </div>
          <span style={{ fontSize: 11, color: 'var(--color-text-subtle)' }}>
            If provided, sent as <code>Authorization: Bearer &lt;token&gt;</code>
          </span>
        </div>

        <Input
          label="Tenant ID (optional)"
          placeholder="Leave empty to omit X-Tenant-Id header"
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          mono
          hint="If provided, sent as X-Tenant-Id header on every request"
        />
      </div>
    </Card>
  );
}

export function Settings() {
  const { source, target, setSource, setTarget, resetSourceStatus, resetTargetStatus } = useServerStore();

  const handleSaveSource = (patch: Partial<ServerConfig>) => {
    setSource(patch);
    resetSourceStatus();
  };

  const handleSaveTarget = (patch: Partial<ServerConfig>) => {
    setTarget(patch);
    resetTargetStatus();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 820 }}>
      <Topbar
        title="Settings"
        subtitle="Configure FHIR server connections and application preferences"
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ServerForm
            title="Source Server (Old)"
            config={source}
            onSave={handleSaveSource}
          />
          <ServerCard role="source" />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ServerForm
            title="Target Server (New)"
            config={target}
            onSave={handleSaveTarget}
          />
          <ServerCard role="target" />
        </div>
      </div>

      {/* Info */}
      <Card size="sm">
        <div className="card-title">Authentication</div>
        <div style={{ fontSize: 13, color: 'var(--color-text)', lineHeight: 1.6 }}>
          <p>
            <strong>Bearer Token:</strong> If provided, added as <code style={{ fontSize: 11, fontFamily: 'monospace', background: 'var(--color-surface-3)', padding: '1px 4px', borderRadius: 3 }}>Authorization: Bearer &lt;token&gt;</code> header to all requests.
            Leave blank for no authentication.
          </p>
          <p style={{ marginTop: 8 }}>
            <strong>Tenant ID:</strong> If provided, added as <code style={{ fontSize: 11, fontFamily: 'monospace', background: 'var(--color-surface-3)', padding: '1px 4px', borderRadius: 3 }}>X-Tenant-Id: &lt;value&gt;</code> header.
            Leave blank to omit the header.
          </p>
        </div>
      </Card>
    </div>
  );
}
