#!/usr/bin/env tsx
/**
 * CP-061 — replacement reason consumption guard.
 *
 * The portal surfaces the reason as a CANONICAL CODE (raw redacted) and renders labels only from
 * the PS-502 contract it fetches — it keeps NO local code->label map. This pins:
 *   - toReasonCode redacts any non-canonical / raw / empty value to null (raw never crosses);
 *   - validateReasonContract accepts only the pinned version with every code exactly once and a
 *     non-empty label, and FAILS CLOSED on anything else;
 *   - the reason-contract proxy forwards the bearer, validates, and fails closed;
 *   - the read model selects reason and redacts it; the contract exposes reasonCode;
 *   - no customer-facing reason label is hardcoded in a replacement-aware source file.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  toReasonCode,
  validateReasonContract,
  PORTAL_REPLACEMENT_REASON_CODES,
  REPLACEMENT_REASON_CONTRACT_VERSION,
} from '../src/lib/client-portal/replacement-reason';

let failures = 0;
function check(condition: boolean, message: string): void {
  if (condition) console.log(`  PASS ${message}`);
  else {
    console.error(`  FAIL ${message}`);
    failures += 1;
  }
}
const read = (path: string): string => readFileSync(path, 'utf8');
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(path);
  }
  return out;
}

// ── Behaviour: canonical codes + redaction ────────────────────────────────────────────────
check(
  PORTAL_REPLACEMENT_REASON_CODES.join(',') === 'damaged,wrong_item,lost_in_transit,other',
  'the four canonical reason codes are frozen',
);
check(
  ['damaged', 'wrong_item', 'lost_in_transit', 'other'].every((code) => toReasonCode(code) === code),
  'toReasonCode passes every canonical code through',
);
check(
  toReasonCode('warehouse picked wrong SKU') === null &&
    toReasonCode('DAMAGED') === null &&
    toReasonCode('') === null &&
    toReasonCode(null) === null &&
    toReasonCode(undefined) === null,
  'toReasonCode redacts raw / non-canonical / empty / null to null (raw never crosses)',
);

// ── Behaviour: the contract validator fails closed ────────────────────────────────────────
const validContract = {
  version: 'replacement-request-v1',
  reasons: [
    { code: 'damaged', label: 'Damaged' },
    { code: 'wrong_item', label: 'Wrong item' },
    { code: 'lost_in_transit', label: 'Lost in transit' },
    { code: 'other', label: 'Other' },
  ],
};
check(
  JSON.stringify(validateReasonContract(validContract)) === JSON.stringify(validContract),
  'validateReasonContract accepts the pinned version with the complete code/label set',
);
check(
  REPLACEMENT_REASON_CONTRACT_VERSION === 'replacement-request-v1',
  'the pinned contract version is replacement-request-v1',
);
const badCases: Array<[string, unknown]> = [
  ['null', null],
  ['non-object', 'nope'],
  ['wrong version', { ...validContract, version: 'replacement-request-v2' }],
  ['missing code', { version: 'replacement-request-v1', reasons: validContract.reasons.slice(0, 3) }],
  ['non-canonical extra code', {
    version: 'replacement-request-v1',
    reasons: [...validContract.reasons, { code: 'nonsense', label: 'X' }],
  }],
  ['duplicate code', {
    version: 'replacement-request-v1',
    reasons: [...validContract.reasons, { code: 'damaged', label: 'Damaged again' }],
  }],
  ['empty label', {
    version: 'replacement-request-v1',
    reasons: [{ code: 'damaged', label: '' }, ...validContract.reasons.slice(1)],
  }],
  ['reasons not an array', { version: 'replacement-request-v1', reasons: 'x' }],
];
check(
  badCases.every(([, payload]) => validateReasonContract(payload) === null),
  `validateReasonContract fails closed on every bad case (${badCases.map(([n]) => n).join('; ')})`,
);

// ── Source: the proxy forwards, validates, and fails closed ───────────────────────────────
const route = stripComments(read('src/routes/client-portal/replacements.ts'));
check(
  route.includes("'/replacements/reason-contract'") &&
    route.includes('validateReasonContract') &&
    route.includes('replacement_reason_contract_invalid') &&
    route.includes('PREPSHIP_API_URL'),
  'the reason-contract proxy exists, forwards to PrepShip, validates, and fails closed',
);

// ── Source: the read model redacts reason; the contract exposes reasonCode ────────────────
const readModel = stripComments(read('src/lib/client-portal/read-models/replacements.ts'));
check(
  /r\.reason/.test(readModel) && readModel.includes('toReasonCode(row.reason)'),
  'the read model selects reason and maps it through toReasonCode',
);
const contract = stripComments(read('src/lib/client-portal/contracts/replacements.ts'));
check(
  contract.includes('reasonCode: PortalReplacementReasonCode | null'),
  'the contract exposes reasonCode (canonical code), not raw reason',
);

// ── Source: no local label map ────────────────────────────────────────────────────────────
// The two distinctive labels must never be hardcoded in a replacement-aware source file — they
// come only from the fetched contract. ('Damaged'/'Other' are common words, so only these two
// are scanned to avoid false positives from unrelated code.)
const DISTINCTIVE_LABELS = ['Wrong item', 'Lost in transit'];
const sources = [...walk('portal-client/src'), ...walk('src')];
const labelOffenders = sources.filter((path) => {
  const text = stripComments(read(path));
  return /replacement/i.test(text) && DISTINCTIVE_LABELS.some((label) => text.includes(label));
});
check(
  labelOffenders.length === 0,
  `no reason label is hardcoded in a replacement-aware source file (offenders: ${labelOffenders.join(', ') || 'none'})`,
);

// ── package.json wiring ───────────────────────────────────────────────────────────────────
const pkg = JSON.parse(read('package.json'));
check(
  pkg.scripts?.['test:client-portal-replacement-reason'] ===
    'tsx scripts/client-portal-replacement-reason-guard.ts',
  'package.json exposes test:client-portal-replacement-reason',
);

if (failures > 0) {
  console.error(`\n✖ CP-061 reason consumption guard: ${failures} failing check(s).`);
  process.exit(1);
}
console.log('\nPASS CP-061 replacement reason consumption guard');
