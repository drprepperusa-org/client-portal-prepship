import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://user:pass@localhost:5432/client_portal_audit_metadata';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY ||= 'test';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test';
process.env.SUPABASE_JWT_SECRET ||= 'test';

const { sanitizePortalAuditMetadata } = await import('../src/lib/client-portal/audit');

const rangeStart = new Date('2026-07-18T00:00:00.000Z');
const rangeEnd = new Date('2026-07-18T23:59:59.999Z');

assert.deepEqual(
  sanitizePortalAuditMetadata({
    from: rangeStart,
    to: rangeEnd,
    nested: { requestedAt: rangeStart },
    apiToken: 'must-not-leak',
  }),
  {
    from: rangeStart.toISOString(),
    to: rangeEnd.toISOString(),
    nested: { requestedAt: rangeStart.toISOString() },
    apiToken: '[redacted]',
  },
  'audit metadata preserves valid dates as ISO strings while retaining redaction',
);

assert.equal(
  sanitizePortalAuditMetadata(new Date('invalid')),
  null,
  'invalid dates do not become empty audit objects',
);

console.log('ok: audit metadata serializes dates without losing their values');
