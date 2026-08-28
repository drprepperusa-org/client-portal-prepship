/**
 * CP-059 — committed mutation harness.
 *
 * Review declined to count "22 mutations killed" as acceptance evidence, correctly: the
 * harnesses lived in a scratch directory, so the commands did not exist at the reviewed SHA and
 * nobody could reproduce the claim. Investigative evidence is not acceptance evidence. So the
 * harness is committed and runnable: `npm run test:cp-059-mutations`.
 *
 * Each entry breaks ONE property in a source file, runs the guard that is supposed to defend it,
 * and requires that guard to go red. A mutation whose anchor does not match is reported as NOT
 * APPLIED and fails the run — an unapplied mutation looks exactly like a killed one, and that
 * false negative is what makes a mutation suite worthless.
 *
 * Sources are restored after every mutation, and the run fails if any file is left modified.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

type Mutation = {
  /** What the mutation breaks, in terms of the property — not the syntax. */
  readonly label: string;
  readonly file: string;
  /** The guard expected to catch it. */
  readonly guard: string;
  readonly from: string;
  readonly to: string;
};

const PROXY = 'src/lib/client-portal/prepship-billing-details-proxy.ts';
const HTML = 'src/lib/client-portal/invoice-html.ts';
const XLSX = 'portal-client/src/lib/invoiceExcel.ts';
const EVENTS = 'src/lib/client-portal/read-models/canonical-invoice-events.ts';

const CONTRACT = 'scripts/cp-059-producer-contract-guard.ts';
const BOUNDARY = 'scripts/cp-059-canonical-billing-guard.ts';
const DISPLAY = 'scripts/client-portal-billing-returns-display-guard.ts';
const SORT = 'scripts/client-portal-billing-line-item-sort-guard.ts';

export const MUTATIONS: readonly Mutation[] = [
  // ---- the two defects that reached review, reinstated verbatim ----
  {
    label: 'REGRESSION: reject `present:false` carrying a number (the rule that would have 502ed every request)',
    file: PROXY, guard: BOUNDARY,
    from: '  if (row.hasReturnProcessingLine === true && asNumber(row.returnProcessingTotal) === null) return null;',
    to: '  if (row.hasReturnProcessingLine === true && asNumber(row.returnProcessingTotal) === null) return null;\n'
      + '  if (row.hasReturnPostageLine === false && asNumber(row.returnPostageTotal) !== null) return null;',
  },
  {
    label: 'REGRESSION: require a non-null orderId again (rejects every orderless storage row)',
    file: PROXY, guard: CONTRACT,
    from: '  if (canonicalEventId === null || !rowTypeValid || !destinationValid',
    to: '  if (asInteger(row.orderId) === null || canonicalEventId === null || !rowTypeValid || !destinationValid',
  },

  // ---- identity ----
  {
    label: 'identity: stop requiring canonicalEventId, so an identity-less row is accepted',
    // BOUNDARY, not CONTRACT: every row in the producer fixture already carries an identity, so
    // the contract guard cannot see this break. The boundary guard asserts the rejection directly.
    file: PROXY, guard: BOUNDARY,
    from: '  if (canonicalEventId === null || !rowTypeValid || !destinationValid',
    to: '  if (!rowTypeValid || !destinationValid',
  },
  {
    label: 'identity: sort tiebreak goes back to orderId|returnId|rowType, collapsing storage rows',
    file: EVENTS, guard: SORT,
    from: "  return String((row as { canonicalEventId?: unknown }).canonicalEventId ?? '');",
    to: "  return `${row.orderId ?? ''}|${row.returnId ?? ''}|${row.rowType ?? ''}`;",
  },

  {
    // The bug that shipped in this very PR: the projection is an allowlist, and a field nobody
    // names is a field silently dropped. Only CI caught it, because the projection was inline in
    // a database-bound function and no static guard could reach it.
    label: 'identity: the served DTO projection drops canonicalEventId (frontend loses all identity)',
    file: EVENTS, guard: CONTRACT,
    from: "      canonicalEventId: (row as { canonicalEventId?: string | null }).canonicalEventId ?? null,\n",
    to: '',
  },

  // ---- producer-guaranteed money ----
  {
    label: 'money: stop requiring the producer-guaranteed totals, so a row with no grandTotal prints $0.00',
    file: PROXY, guard: BOUNDARY,
    from: '  const moneyValid = REQUIRED_NUMBER_FIELDS.every((field) => asNumber(row[field]) !== null);',
    to: '  const moneyValid = true;',
  },
  {
    label: 'money: drop grandTotal from the required list (the field the fabricated zero came from)',
    file: PROXY, guard: BOUNDARY,
    from: "  'storageTotal', 'adjustmentTotal', 'grandTotal',",
    to: "  'storageTotal', 'adjustmentTotal',",
  },

  // ---- presence decides rendering, in both serializers ----
  {
    label: 'HTML: render return money regardless of presence (prints the carried 0)',
    file: HTML, guard: DISPLAY,
    from: "present === true ? money(value) : '&mdash;';",
    to: 'money(value);',
  },
  {
    label: 'HTML: only a literal false blanks, so null presence prints $0.00',
    file: HTML, guard: DISPLAY,
    from: "present === true ? money(value) : '&mdash;';",
    to: "present === false ? '&mdash;' : money(value);",
  },
  {
    label: 'HTML: blank a real $0.00 line as though it were absent',
    file: HTML, guard: DISPLAY,
    from: "present === true ? money(value) : '&mdash;';",
    to: "present === true && Number(value) !== 0 ? money(value) : '&mdash;';",
  },
  {
    label: 'XLSX: put return money back through num(), fabricating a summable 0',
    file: XLSX, guard: DISPLAY,
    from: "  present === true\n    ? { type: Number, value: num(value), format: MONEY_FORMAT }\n    : { type: String, value: '' };",
    to: '  ({ type: Number, value: num(value), format: MONEY_FORMAT });',
  },
  {
    label: 'XLSX: blank a real $0.00 line as though it were absent',
    file: XLSX, guard: DISPLAY,
    from: '  present === true\n',
    to: '  present === true && num(value) !== 0\n',
  },

  // ---- ordering ----
  {
    label: 'sort: nulls sort FIRST, so an absent amount leads a money column',
    file: EVENTS, guard: SORT,
    from: '  if (av === null || av === undefined) return bv === null || bv === undefined ? 0 : 1;\n  if (bv === null || bv === undefined) return -1;',
    to: '  if (av === null || av === undefined) return bv === null || bv === undefined ? 0 : -1;\n  if (bv === null || bv === undefined) return 1;',
  },
  {
    label: 'sort: direction ignored, so desc silently returns asc',
    file: EVENTS, guard: SORT,
    from: "const dir: 1 | -1 = String(sortDir).toLowerCase() === 'desc' ? -1 : 1;",
    to: 'const dir: 1 | -1 = 1;',
  },
  {
    label: 'sort: whitelist dropped, so any field name sorts including internal ones',
    file: EVENTS, guard: SORT,
    from: '  const key = sortBy && SORTABLE.has(sortBy) ? sortBy : null;',
    to: '  const key = sortBy || null;',
  },

  // ---- redaction ----
  {
    label: 'redaction: pass the whole upstream row through, leaking rate/cost/provider fields',
    file: PROXY, guard: BOUNDARY,
    from: '  for (const field of ALLOWED_STRING_FIELDS) out[field] = asString(row[field]);',
    to: '  Object.assign(out, row);\n  for (const field of ALLOWED_STRING_FIELDS) out[field] = asString(row[field]);',
  },
];

/**
 * A guard that is ALREADY RED reports every mutation as killed.
 *
 * This is not hypothetical: two of these guards were red at baseline the first time this harness
 * ran, because their fixtures had not been updated for the new contract. Eleven mutations
 * "passed" against them and the result was worthless — a red guard cannot distinguish a broken
 * property from a broken fixture.
 *
 * So the baseline is proven first. If any guard is not green before a single mutation is
 * applied, the run aborts rather than producing evidence nobody can trust.
 */
function assertBaselineGreen(guards: readonly string[]): void {
  const red: string[] = [];
  for (const guard of guards) {
    try {
      execFileSync('npx', ['tsx', guard], { stdio: 'pipe', shell: process.platform === 'win32' });
    } catch {
      red.push(guard);
    }
  }
  if (red.length > 0) {
    console.error('ABORT — these guards are RED before any mutation was applied:');
    for (const guard of red) console.error(`  ${guard}`);
    console.error('A red guard reports every mutation as killed. Fix the baseline first.');
    process.exit(1);
  }
  console.log(`baseline: all ${guards.length} guards green before mutating\n`);
}

function run(): number {
  assertBaselineGreen([...new Set(MUTATIONS.map((m) => m.guard))]);
  const files = [...new Set(MUTATIONS.map((m) => m.file))];
  const originals = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));
  const restore = () => { for (const [f, text] of originals) writeFileSync(f, text); };

  let failures = 0;
  for (const mutation of MUTATIONS) {
    const original = originals.get(mutation.file)!;
    const crlf = original.includes('\r\n');
    const normalized = original.split('\r\n').join('\n');

    // A mutation that does not apply proves nothing. Treated as a failure, never as a pass.
    if (!normalized.includes(mutation.from)) {
      console.error(`NOT APPLIED  ${mutation.label}`);
      console.error(`             anchor missing in ${mutation.file} — this mutation proves nothing`);
      failures += 1;
      continue;
    }
    const mutated = normalized.replace(mutation.from, mutation.to);
    if (mutated === normalized) {
      console.error(`NOT APPLIED  ${mutation.label} (replacement was a no-op)`);
      failures += 1;
      continue;
    }

    writeFileSync(mutation.file, crlf ? mutated.split('\n').join('\r\n') : mutated);
    let killed = false;
    try {
      execFileSync('npx', ['tsx', mutation.guard], { stdio: 'pipe', shell: process.platform === 'win32' });
    } catch {
      killed = true;
    }
    restore();

    if (killed) {
      console.log(`killed       ${mutation.label}`);
    } else {
      console.error(`SURVIVED     ${mutation.label}`);
      console.error(`             ${mutation.guard} stayed green while the property was broken`);
      failures += 1;
    }
  }

  restore();
  for (const [f, text] of originals) {
    if (readFileSync(f, 'utf8') !== text) {
      console.error(`RESTORE FAILED for ${f} — the working tree is dirty`);
      failures += 1;
    }
  }
  return failures;
}

const failures = run();
console.log('');
if (failures > 0) {
  console.error(`FAIL CP-059 mutation harness — ${failures} of ${MUTATIONS.length} not killed`);
  process.exit(1);
}
console.log(`PASS CP-059 mutation harness — ${MUTATIONS.length}/${MUTATIONS.length} mutations killed`);
