import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://user:pass@localhost:5432/cp055';
process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY ||= 'test';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test';
process.env.SUPABASE_JWT_SECRET ||= 'test';

const { getBillingLastGenerated } = await import(
  '../src/lib/client-portal/read-models/billing-status'
);

assert.equal(
  await getBillingLastGenerated(async () => []),
  null,
  'a successful empty billing table remains distinguishable as never generated',
);
console.log('ok: a successful empty billing table returns null');

assert.deepEqual(
  await getBillingLastGenerated(async () => [{ at: '2026-07-14T04:00:00.000Z' }]),
  { at: '2026-07-14T04:00:00.000Z' },
  'a successful billing-status read returns its canonical timestamp',
);
console.log('ok: a successful billing-status read returns the canonical timestamp');

await assert.rejects(
  getBillingLastGenerated(async () => {
    throw Object.assign(new Error('database connection terminated'), { code: '57P01' });
  }),
  /database connection terminated/,
  'an operational billing-status failure must propagate',
);
console.log('ok: an operational billing-status failure propagates');

console.log('\nCP-055 runtime failure fixtures passed.');
