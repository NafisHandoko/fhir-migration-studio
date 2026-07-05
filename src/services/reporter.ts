/**
 * Reporter — generates a migration summary report from a completed job.
 */

import type { MigrationJob, MigrationReport } from '../types/migration';

/**
 * Generate a MigrationReport from a completed MigrationJob.
 */
export function generateReport(job: MigrationJob): MigrationReport {
  const startedAt = job.startedAt ?? new Date().toISOString();
  const completedAt = job.completedAt ?? new Date().toISOString();
  const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime();

  return {
    jobId: job.id,
    mode: job.mode,
    startedAt,
    completedAt,
    durationMs,
    resourceTypes: job.resourceTypes,
    summary: job.progress,
    totals: job.totals,
    status: job.status,
    error: job.error,
  };
}

/**
 * Format a migration report as a human-readable text string.
 */
export function formatReportText(report: MigrationReport): string {
  const duration = formatDuration(report.durationMs);
  const lines: string[] = [
    '=== FHIR Migration Report ===',
    `Job ID:      ${report.jobId}`,
    `Mode:        ${report.mode}`,
    `Status:      ${report.status}`,
    `Started:     ${report.startedAt}`,
    `Completed:   ${report.completedAt}`,
    `Duration:    ${duration}`,
    '',
    '--- Resource Summary ---',
  ];

  for (const rt of report.resourceTypes) {
    const p = report.summary[rt];
    if (!p) continue;
    const pct = p.total > 0 ? Math.round((p.uploaded / p.total) * 100) : 0;
    lines.push(
      `${rt.padEnd(24)} total=${p.total}  ok=${p.uploaded}  failed=${p.failed}  skipped=${p.skipped}  (${pct}%)`,
    );
  }

  lines.push('');
  lines.push('--- Totals ---');
  const t = report.totals;
  const totalPct = t.total > 0 ? Math.round((t.uploaded / t.total) * 100) : 0;
  lines.push(`Total:     ${t.total}`);
  lines.push(`Uploaded:  ${t.uploaded} (${totalPct}%)`);
  lines.push(`Failed:    ${t.failed}`);
  lines.push(`Skipped:   ${t.skipped}`);

  if (report.error) {
    lines.push('');
    lines.push(`Error: ${report.error}`);
  }

  return lines.join('\n');
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
