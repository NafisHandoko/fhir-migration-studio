import { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Play,
  XCircle,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  Trash2,
  Settings as SettingsIcon,
} from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { ProgressBar } from '../components/ui/ProgressBar';
import { ServerCard } from '../components/server/ServerCard';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { useServerStore } from '../store/serverStore';
import { useCleanupStore } from '../store/cleanupStore';
import { useSettingsStore } from '../store/settingsStore';
import { useLogStore } from '../store/logStore';
import { scanCleanupResources, executeCleanup } from '../services/cleanupService';
import { MIGRATABLE_RESOURCE_TYPES, type FhirResourceType } from '../types/fhir';
import { splitBundleEntries } from '../services/bundleBuilder';

type Step = 'configure' | 'scanning' | 'confirming' | 'deleting' | 'done';

const STEP_LABELS: Record<Step, string> = {
  configure: 'Configure',
  scanning: 'Scanning',
  confirming: 'Confirm',
  deleting: 'Deleting',
  done: 'Complete',
};

export function Cleanup() {
  const navigate = useNavigate();
  const { target, targetStatus } = useServerStore();
  const { current: job, setJob, updateStatus, clearCurrent } = useCleanupStore();
  const settings = useSettingsStore();
  const logEntries = useLogStore((s) => s.entries);

  const [step, setStep] = useState<Step>('configure');
  const [selected, setSelected] = useState<Set<FhirResourceType>>(
    new Set(MIGRATABLE_RESOURCE_TYPES),
  );
  
  // Filtering states
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [initiator, setInitiator] = useState('fhir-migration-tool');
  const [isDryRun, setIsDryRun] = useState(false);
  const [scannedResources, setScannedResources] = useState<Record<string, any[]>>({});
  
  // Track cancel flag internally
  const [isCancelled, setIsCancelled] = useState(false);

  // Sync step state with the active job if one is running or completed
  useEffect(() => {
    if (job) {
      if (job.status === 'done' || job.status === 'error') {
        setStep('done');
      } else if (job.status === 'cancelled' || job.status === 'idle') {
        setStep('configure');
      } else if (job.status === 'scanning') {
        setStep('scanning');
      } else if (job.status === 'deleting') {
        setStep('deleting');
      }
    } else {
      setStep('configure');
    }
  }, [job]);

  const toggleResource = (rt: FhirResourceType) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rt)) next.delete(rt);
      else next.add(rt);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === MIGRATABLE_RESOURCE_TYPES.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(MIGRATABLE_RESOURCE_TYPES));
    }
  };

  const canStart =
    target.baseUrl &&
    selected.size > 0 &&
    initiator.trim().length > 0 &&
    (targetStatus.state === 'connected' || targetStatus.state === 'idle');

  // Filter logs related to this cleanup job
  const filteredLogs = useMemo(() => {
    if (!job) return [];
    return logEntries
      .filter((e) => e.jobId === job.id || e.message.includes('[Cleanup]'))
      .slice(0, 100);
  }, [logEntries, job]);

  // Calculate estimated bundles for confirming view
  const estimations = useMemo(() => {
    let totalResources = 0;
    let totalBundles = 0;
    const typeEstimations: Record<string, { count: number; bundles: number }> = {};

    Object.entries(scannedResources).forEach(([rt, resources]) => {
      const count = resources.length;
      totalResources += count;

      if (count > 0) {
        // Build mock entries containing DELETE requests to split them
        const mockEntries = resources.map((r) => ({
          request: { method: 'DELETE' as const, url: `${r.resourceType}/${r.id}` },
        }));
        const bundles = splitBundleEntries(mockEntries);
        totalBundles += bundles.length;
        typeEstimations[rt] = { count, bundles: bundles.length };
      } else {
        typeEstimations[rt] = { count: 0, bundles: 0 };
      }
    });

    return { totalResources, totalBundles, typeEstimations };
  }, [scannedResources]);

  const handleScan = useCallback(async () => {
    setIsCancelled(false);
    const jobId = `cleanup-${Date.now().toString().slice(-6)}`;
    const newJob = {
      id: jobId,
      status: 'scanning' as const,
      isDryRun,
      selectedTypes: Array.from(selected),
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      initiatorComponent: initiator,
      progress: {} as Record<string, { total: number; deleted: number; failed: number }>,
      totals: { total: 0, deleted: 0, failed: 0 },
      startedAt: new Date().toISOString(),
    };
    
    // Initialize progress values to 0
    Array.from(selected).forEach((rt) => {
      newJob.progress[rt] = { total: 0, deleted: 0, failed: 0 };
    });

    setJob(newJob);
    setStep('scanning');

    const checkStatus = async () => {
      return !isCancelled;
    };

    try {
      const scanResults = await scanCleanupResources({
        target,
        selectedTypes: Array.from(selected),
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        initiatorComponent: initiator,
        checkStatus,
      });

      setScannedResources(scanResults);
      updateStatus('confirming');
      setStep('confirming');
    } catch (err) {
      updateStatus('error');
      setStep('configure');
    }
  }, [target, selected, dateFrom, dateTo, initiator, isDryRun, isCancelled, setJob, updateStatus]);

  const handleExecute = useCallback(async () => {
    if (!job) return;
    updateStatus('deleting');
    setStep('deleting');

    const checkStatus = async () => {
      return !isCancelled;
    };

    try {
      await executeCleanup({
        target,
        selectedTypes: job.selectedTypes,
        resourcesMap: scannedResources,
        isDryRun: job.isDryRun,
        jobId: job.id,
        checkStatus,
      });
      setStep('done');
    } catch (err) {
      updateStatus('error');
      setStep('done');
    }
  }, [target, job, scannedResources, isCancelled, updateStatus]);

  const handleCancel = () => {
    setIsCancelled(true);
    updateStatus('cancelled');
    setStep('configure');
    clearCurrent();
  };

  const overallPct = useMemo(() => {
    if (!job || job.totals.total === 0) return 0;
    const completed = job.totals.deleted + job.totals.failed;
    return Math.round((completed / job.totals.total) * 100);
  }, [job]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 900 }}>
      <Topbar
        title="Migration Resource Cleanup"
        subtitle="Safely clean up resources from the destination FHIR server"
      />

      {/* Step indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 4 }}>
        {(Object.keys(STEP_LABELS) as Step[]).map((s, i) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                className={`step-dot ${step === s ? 'active' : i < (Object.keys(STEP_LABELS) as Step[]).indexOf(step) ? 'done' : 'pending'
                  }`}
              >
                {i < (Object.keys(STEP_LABELS) as Step[]).indexOf(step) ? (
                  <CheckCircle2 size={12} />
                ) : (
                  i + 1
                )}
              </div>
              <div className="step-info">
                <span className="step-title">{STEP_LABELS[s]}</span>
              </div>
            </div>
            {i < Object.keys(STEP_LABELS).length - 1 && (
              <div style={{ flex: 1, height: 1, backgroundColor: 'var(--color-border)', margin: '0 12px' }} />
            )}
          </div>
        ))}
      </div>

      {/* Configure Step */}
      {step === 'configure' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Destination Server Check */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
            <ServerCard role="target" onEdit={() => navigate('/settings')} />
          </div>

          {!target.baseUrl && (
            <div className="alert alert-warning">
              <AlertTriangle size={16} />
              <span>
                Please configure the destination server in{' '}
                <button
                  style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', textDecoration: 'underline', fontSize: 'inherit' }}
                  onClick={() => navigate('/settings')}
                >
                  Settings
                </button>{' '}
                first.
              </span>
            </div>
          )}

          {/* Filters card */}
          <Card title="Cleanup Filters">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <Input
                label="From Date/Time"
                type="datetime-local"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                hint="Filter resources created after this date/time"
              />
              <Input
                label="To Date/Time"
                type="datetime-local"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                hint="Filter resources created before this date/time"
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <Input
                label="Initiator Component Value"
                value={initiator}
                onChange={(e) => setInitiator(e.target.value)}
                hint="Matching extension valueString. Standard is fhir-migration-tool."
              />
              <div className="input-group">
                <span className="input-label">Execution Mode</span>
                <label className="checkbox-group" style={{ height: 38, border: '1px solid var(--color-border)', padding: '0 12px', borderRadius: 6, display: 'flex', alignItems: 'center', cursor: 'pointer', backgroundColor: isDryRun ? 'rgba(59,130,246,0.06)' : 'transparent' }}>
                  <input
                    type="checkbox"
                    checked={isDryRun}
                    onChange={(e) => setIsDryRun(e.target.checked)}
                  />
                  <span className="checkbox-label" style={{ fontWeight: 600 }}>Dry Run Mode</span>
                </label>
                <span style={{ fontSize: 11, color: 'var(--color-text-subtle)', marginTop: 4 }}>
                  Only scans and estimates bundles without deleting any resources.
                </span>
              </div>
            </div>
          </Card>

          {/* Resource selection */}
          <Card title="Resource Types to Clean Up">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <label className="checkbox-group">
                <input
                  type="checkbox"
                  checked={selected.size === MIGRATABLE_RESOURCE_TYPES.length}
                  onChange={toggleAll}
                />
                <span className="checkbox-label" style={{ fontWeight: 600 }}>Select All</span>
              </label>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                ({selected.size} of {MIGRATABLE_RESOURCE_TYPES.length} selected)
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {MIGRATABLE_RESOURCE_TYPES.map((rt) => (
                <label key={rt} className="checkbox-group" style={{ padding: '6px 8px', borderRadius: 4, border: '1px solid', borderColor: selected.has(rt) ? 'var(--color-primary)' : 'var(--color-border)', backgroundColor: selected.has(rt) ? 'var(--color-primary-muted)' : 'transparent', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={selected.has(rt)}
                    onChange={() => toggleResource(rt)}
                  />
                  <span className="checkbox-label">{rt}</span>
                </label>
              ))}
            </div>
          </Card>

          {/* Enforce dynamic bundle limits notification */}
          <div style={{
            background: 'var(--color-surface-2)',
            borderRadius: 8,
            padding: '12px 16px',
            fontSize: 12,
            color: 'var(--color-text-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            border: '1px dashed var(--color-border)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <SettingsIcon size={14} style={{ color: 'var(--color-primary)' }} />
              <span>
                Global settings: Max <strong>{settings.maxBundleResourceCount} resources</strong> per bundle, Max <strong>{settings.maxBundleRequestSizeMb} MB</strong> request size.
              </span>
            </div>
            <button
              style={{ background: 'none', border: 'none', color: 'var(--color-primary)', cursor: 'pointer', fontSize: 11, textDecoration: 'underline' }}
              onClick={() => navigate('/settings')}
            >
              Modify
            </button>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button
              variant="primary"
              size="lg"
              icon={<Play size={15} />}
              disabled={!canStart}
              onClick={handleScan}
            >
              Scan & Prepare
            </Button>
          </div>
        </div>
      )}

      {/* Scanning Step */}
      {step === 'scanning' && job && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>Scanning FHIR Destination Server</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  Job ID: <span style={{ fontFamily: 'monospace' }}>{job.id}</span>
                </div>
              </div>
              <Button variant="danger" size="sm" icon={<XCircle size={13} />} onClick={handleCancel}>
                Cancel
              </Button>
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
              Scanning target server for resources created by the migration tool matching initiator: <code>{job.initiatorComponent}</code>.
            </div>
          </Card>

          <Card title="Scan Progress">
            <div className="table-wrapper" style={{ border: 'none', borderRadius: 'var(--radius-lg)' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Resource Type</th>
                    <th>Status</th>
                    <th>Found Matching</th>
                  </tr>
                </thead>
                <tbody>
                  {job.selectedTypes.map((rt) => {
                    const p = job.progress[rt];
                    const hasScanned = scannedResources[rt] !== undefined;
                    return (
                      <tr key={rt}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <ChevronRight size={12} style={{ color: 'var(--color-text-subtle)' }} />
                            {rt}
                          </div>
                        </td>
                        <td>
                          {hasScanned ? (
                            <Badge variant="success">Scanned</Badge>
                          ) : (
                            <Badge variant="primary">Scanning...</Badge>
                          )}
                        </td>
                        <td>{p?.total ?? 0} resources</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* Confirming Step */}
      {step === 'confirming' && job && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="alert alert-warning" style={{ background: 'linear-gradient(135deg, rgba(239,68,68,0.12), rgba(220,38,38,0.08))', border: '1px solid rgba(239,68,68,0.3)' }}>
            <AlertTriangle size={18} style={{ color: 'var(--color-error)' }} />
            <div>
              <div style={{ fontWeight: 600, color: 'var(--color-error)' }}>Confirm Deletion of Migrated Resources</div>
              <div style={{ fontSize: 12, marginTop: 4, color: 'var(--color-text)' }}>
                Please review the matching resources found on the target server. Proceeding will permanently delete these resources from the destination.
              </div>
            </div>
          </div>

          <Card title="Scan Result Summary">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div style={{ background: 'var(--color-surface-2)', padding: 16, borderRadius: 8, textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Total Matching Resources
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4, color: 'var(--color-error)' }}>
                  {estimations.totalResources.toLocaleString()}
                </div>
              </div>
              <div style={{ background: 'var(--color-surface-2)', padding: 16, borderRadius: 8, textAlign: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Estimated Transaction Bundles
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, marginTop: 4, color: 'var(--color-primary)' }}>
                  {estimations.totalBundles.toLocaleString()}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 20, fontSize: 12, color: 'var(--color-text-muted)', background: 'var(--color-surface-3)', padding: '10px 14px', borderRadius: 6 }}>
              <span>Initiator component: <code>{job.initiatorComponent}</code></span>
              {job.dateFrom && <span>From: <code>{new Date(job.dateFrom).toLocaleString()}</code></span>}
              {job.dateTo && <span>To: <code>{new Date(job.dateTo).toLocaleString()}</code></span>}
              {job.isDryRun && <span className="text-warning">Dry Run Mode Active</span>}
            </div>
          </Card>

          <Card title="Resources Selected for Deletion">
            <div className="table-wrapper" style={{ border: 'none', borderRadius: 'var(--radius-lg)' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Resource Type</th>
                    <th>Matching Resources</th>
                    <th>Estimated Bundles</th>
                  </tr>
                </thead>
                <tbody>
                  {job.selectedTypes.map((rt) => {
                    const est = estimations.typeEstimations[rt];
                    return (
                      <tr key={rt}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <ChevronRight size={12} style={{ color: 'var(--color-text-subtle)' }} />
                            {rt}
                          </div>
                        </td>
                        <td style={{ fontWeight: 600, color: est?.count > 0 ? 'var(--color-error)' : 'var(--color-text-muted)' }}>
                          {est?.count ?? 0}
                        </td>
                        <td>{est?.bundles ?? 0} bundles</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <Button variant="secondary" onClick={handleCancel}>
              Cancel Cleanup
            </Button>
            <Button
              variant="danger"
              size="lg"
              icon={<Trash2 size={15} />}
              onClick={handleExecute}
            >
              {job.isDryRun ? 'Execute Dry Run' : 'Confirm & Delete Resources'}
            </Button>
          </div>
        </div>
      )}

      {/* Deleting Step */}
      {step === 'deleting' && job && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
                  {job.isDryRun ? 'Executing Dry Run...' : 'Deleting Resources from Target Server...'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                  Job ID: <span style={{ fontFamily: 'monospace' }}>{job.id}</span>
                </div>
              </div>
              <Button variant="danger" size="sm" icon={<XCircle size={13} />} onClick={handleCancel}>
                Cancel
              </Button>
            </div>
            <ProgressBar value={overallPct} showLabel height={8} />
            <div style={{ display: 'flex', gap: 20, marginTop: 10, fontSize: 12, color: 'var(--color-text-muted)' }}>
              <span>Total Matched: {job.totals.total.toLocaleString()}</span>
              <span className="text-success">Deleted: {job.totals.deleted.toLocaleString()}</span>
              <span className={job.totals.failed > 0 ? 'text-error' : ''}>Failed: {job.totals.failed}</span>
            </div>
          </Card>

          {/* Live Progress Logs */}
          <Card title="Activity Stream">
            <div style={{
              background: 'var(--color-surface-4)',
              borderRadius: 8,
              padding: '12px 16px',
              fontFamily: 'monospace',
              fontSize: 11,
              height: 200,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column-reverse',
              gap: 6,
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
            }}>
              {filteredLogs.length === 0 ? (
                <div style={{ color: 'var(--color-text-subtle)' }}>Waiting for activity...</div>
              ) : (
                filteredLogs.map((e) => (
                  <div key={e.id} style={{
                    color: e.level === 'error' ? 'var(--color-error)' : e.level === 'warn' ? 'var(--color-warning)' : e.level === 'success' ? 'var(--color-success)' : 'inherit',
                  }}>
                    [{new Date(e.timestamp).toLocaleTimeString()}] {e.message}
                  </div>
                ))
              )}
            </div>
          </Card>

          {/* Resource progress details */}
          <Card title="Resource Progress">
            <div className="table-wrapper" style={{ border: 'none', borderRadius: 'var(--radius-lg)' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Resource Type</th>
                    <th>Total</th>
                    <th>Deleted</th>
                    <th>Failed</th>
                    <th>Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {job.selectedTypes.map((rt) => {
                    const p = job.progress[rt];
                    const pct = p && p.total > 0 ? Math.round((p.deleted / p.total) * 100) : 0;
                    return (
                      <tr key={rt}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <ChevronRight size={12} style={{ color: 'var(--color-text-subtle)' }} />
                            {rt}
                          </div>
                        </td>
                        <td>{p?.total ?? 0}</td>
                        <td className="text-success">{p?.deleted ?? 0}</td>
                        <td className={p?.failed > 0 ? 'text-error' : ''}>{p?.failed ?? 0}</td>
                        <td style={{ minWidth: 120 }}>
                          <ProgressBar value={pct} showLabel height={3} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* Done Step */}
      {step === 'done' && job && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className={`alert ${job.status === 'done' ? 'alert-success' : 'alert-error'}`} style={{ border: '1px solid' }}>
            {job.status === 'done' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            <div>
              <div style={{ fontWeight: 600 }}>
                {job.isDryRun
                  ? 'Dry Run Completed Successfully'
                  : job.status === 'done'
                    ? 'Cleanup Completed Successfully'
                    : 'Cleanup Failed'}
              </div>
              {job.error && <div style={{ fontSize: 12, marginTop: 2 }}>{job.error}</div>}
            </div>
          </div>

          <Card title="Summary">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
              {[
                { label: 'Total Scanned', value: job.totals.total, color: 'var(--color-text)' },
                { label: 'Deleted', value: job.totals.deleted, color: 'var(--color-success)' },
                { label: 'Failed', value: job.totals.failed, color: job.totals.failed > 0 ? 'var(--color-error)' : 'var(--color-text-muted)' },
              ].map((item) => (
                <div key={item.label} style={{ textAlign: 'center', background: 'var(--color-surface-2)', padding: '12px 6px', borderRadius: 8 }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: item.color }}>{item.value.toLocaleString()}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{item.label}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card title="Resource Results Breakdown">
            <div className="table-wrapper" style={{ border: 'none', borderRadius: 'var(--radius-lg)' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Resource Type</th>
                    <th>Scanned</th>
                    <th>Deleted</th>
                    <th>Failed</th>
                  </tr>
                </thead>
                <tbody>
                  {job.selectedTypes.map((rt) => {
                    const p = job.progress[rt];
                    return (
                      <tr key={rt}>
                        <td>{rt}</td>
                        <td>{p?.total ?? 0}</td>
                        <td className="text-success">{p?.deleted ?? 0}</td>
                        <td className={p?.failed > 0 ? 'text-error' : ''}>{p?.failed ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="primary" onClick={() => { clearCurrent(); setStep('configure'); }}>
              Back to Configure
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
