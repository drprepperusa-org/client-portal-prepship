import type { PortalAuditLogRow } from './contracts/access';

// All-or-nothing exports: never hand the user a silently truncated history.
export const AUDIT_EXPORT_MAX_ROWS = 50_000;
const MAX_BYTES = 16 * 1024 * 1024;

function cell(value: string | number | null) {
  let text = String(value ?? '');
  // Quoting alone does not stop spreadsheet formulas in user-controlled fields.
  if (/^[\s\uFEFF]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** CSV is a backend presentation of the same redacted audit DTO as the table. */
export function auditCsv(rows: PortalAuditLogRow[]): string | null {
  if (rows.length > AUDIT_EXPORT_MAX_ROWS) return null;
  const header = '\uFEFF' + ['Event ID', 'When (UTC)', 'User', 'User ID', 'Activity', 'Activity type',
    'Outcome', 'Session scope', 'Summary', 'Recorded details', 'Notes', 'Event'].map(cell).join(',') + '\r\n';
  const lines = [header];
  let bytes = Buffer.byteLength(header);
  for (const row of rows) {
    const activity = row.activity;
    const line = [row.id, row.createdAt, row.actorEmail, row.actorUserId, activity?.label ?? row.event,
      activity?.category ?? 'Not recorded', activity?.outcome ?? 'Not recorded', row.scopeLabel,
      activity?.summary ?? 'Not recorded',
      activity?.details.map(detail => `${detail.label}: ${detail.value}`).join('\n') || 'Not recorded',
      `${activity?.note ?? 'Only recorded fields are available.'} Session scope describes available stores, not necessarily affected records.`,
      row.event].map(cell).join(',') + '\r\n';
    bytes += Buffer.byteLength(line);
    if (bytes > MAX_BYTES) return null;
    lines.push(line);
  }
  return lines.join('');
}
