#!/usr/bin/env tsx
/**
 * CP-061 — cross-repo reason-contract PARITY test (happy path + mutation negatives).
 *
 * The fail-closed guards prove the Client Portal stays SAFE if the two repos drift. This proves
 * the other half: the CURRENT PrepShip provider and the CURRENT Client Portal consumer AGREE
 * today. It takes the real PS-502 reason-contract handler output (getReplacementReasonContract —
 * exactly the value its route serialises via c.json), round-trips it through JSON as it would
 * cross the wire, and feeds it into CP's REAL validateReasonContract. It then re-runs CP's
 * mutation negatives against that real output. Both exact SHAs are printed.
 *
 * Ownership: CP owns this (the consumer asserts compatibility with its provider). It imports the
 * sibling prepship-v4 checkout by relative path; the CI workflow checks both out side by side and
 * binds both exact SHAs. Offline: no DB, no network — fake env is set before the PS service tree
 * loads so an import cannot reach a real credential.
 */
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

process.env.VERCEL = '1';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://ps502:ps502@127.0.0.1:1/ps502_parity';
process.env.SUPABASE_URL = 'https://ps502-parity.supabase.invalid';
process.env.SUPABASE_ANON_KEY = 'ps502-parity-anon-not-real';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'ps502-parity-service-not-real';
process.env.SUPABASE_JWT_SECRET = 'ps502-parity-jwt-not-real';
process.env.REPLACEMENTS_ENABLED = 'true';
process.env.REPLACEMENTS_LABEL_ENABLED = 'false';

const [{ getReplacementReasonContract }, { validateReasonContract }] = await Promise.all([
  // The real PrepShip provider (sibling checkout) — the exact value its route serialises.
  import('../../../prepship-v4/src/services/replacement-reason-contract'),
  // The real Client Portal consumer validator.
  import('../../src/lib/client-portal/replacement-reason'),
]);

function gitSha(dir: string): string {
  try {
    return execSync('git rev-parse HEAD', { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}
const cpSha = gitSha(process.cwd());
const psSha = gitSha(resolve(process.cwd(), '../prepship-v4'));
console.log(`CP client-portal-prepship @ ${cpSha}`);
console.log(`PS prepship-v4            @ ${psSha}\n`);

let failures = 0;
function check(condition: boolean, message: string, detail?: string): void {
  if (condition) console.log(`  PASS ${message}`);
  else {
    console.error(`  FAIL ${message}${detail ? `\n       ${detail}` : ''}`);
    failures += 1;
  }
}

// The real PS output, as it crosses the wire.
const providerJson = JSON.parse(JSON.stringify(getReplacementReasonContract())) as unknown;

// Happy path: the real provider output passes the real consumer validator.
const validated = validateReasonContract(providerJson);
check(validated !== null, 'the real PS-502 contract passes CP validateReasonContract (non-null)');

const EXPECTED = {
  version: 'replacement-request-v1',
  reasons: [
    { code: 'damaged', label: 'Damaged' },
    { code: 'wrong_item', label: 'Wrong item' },
    { code: 'lost_in_transit', label: 'Lost in transit' },
    { code: 'other', label: 'Other' },
  ],
};
check(
  JSON.stringify(validated) === JSON.stringify(EXPECTED),
  'provider and consumer agree on the exact version and the four code/label pairs',
  JSON.stringify(validated),
);

// Mutation negatives: the SAME real output, broken each way, must fail closed in the CP validator.
const mutate = (fn: (clone: { version: string; reasons: Array<{ code: string; label: unknown }> }) => void): unknown => {
  const clone = JSON.parse(JSON.stringify(providerJson));
  fn(clone);
  return clone;
};
const negatives: Array<[string, unknown]> = [
  ['version changed', mutate((c) => { c.version = 'replacement-request-v2'; })],
  ['a code removed', mutate((c) => { c.reasons.pop(); })],
  ['an extra non-canonical code added', mutate((c) => { c.reasons.push({ code: 'nonsense', label: 'X' }); })],
  ['a label blanked', mutate((c) => { c.reasons[0].label = ''; })],
  ['a label made non-string', mutate((c) => { c.reasons[0].label = 123; })],
  ['malformed payload', 'not-a-contract'],
];
check(
  negatives.every(([, payload]) => validateReasonContract(payload) === null),
  `every mutation of the real contract fails closed in the consumer (${negatives.map(([n]) => n).join('; ')})`,
);

console.log(
  `\n${
    failures === 0
      ? `PASS CP-061 reason-contract parity — CP ${cpSha} agrees with PS ${psSha}`
      : `FAIL CP-061 reason-contract parity — ${failures} failure(s)`
  }`,
);
if (failures > 0) process.exit(1);
