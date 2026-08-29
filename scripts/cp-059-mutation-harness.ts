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
  /** The guard expected to catch it. Also the baseline key and the failure message. */
  readonly guard: string;
  /**
   * How to RUN that guard. Defaults to `npx tsx <guard>`.
   *
   * The grid's categories cannot be defended by a static guard — a column that is absent from
   * a React builder is not a string another script can grep for without pinning the exact
   * spelling, which is the brittle assertion this repo keeps having to unwind. The browser
   * proof renders the real grid and reconciles its visible cells, so grid mutations name it
   * here instead.
   */
  readonly command?: readonly string[];
  readonly from: string;
  readonly to: string;
};

const PROXY = 'src/lib/client-portal/prepship-billing-details-proxy.ts';
const HTML = 'src/lib/client-portal/invoice-html.ts';
const XLSX = 'portal-client/src/lib/invoiceExcel.ts';
const EVENTS = 'src/lib/client-portal/read-models/canonical-invoice-events.ts';
const ROWS = 'portal-client/src/lib/invoiceRows.ts';
const GRID = 'portal-client/src/components/billing/invoiceColumns.tsx';
const TYPES = 'src/services/billing-line-types.ts';

const CONTRACT = 'scripts/cp-059-producer-contract-guard.ts';
const BOUNDARY = 'scripts/cp-059-canonical-billing-guard.ts';
const DISPLAY = 'scripts/client-portal-billing-returns-display-guard.ts';
const SORT = 'scripts/client-portal-billing-line-item-sort-guard.ts';
/** Not a tsx script — see Mutation.command. */
const BROWSER = 'npm run test:cp-059-billing:browser';
/** Not a tsx script either — the cross-repo vocabulary gate. */
const VOCAB_PARITY = 'node scripts/prepship-return-vocabulary-parity.mjs';
const VOCAB_PARITY_COMMAND = ['node', 'scripts/prepship-return-vocabulary-parity.mjs', '--allow-unarmed'] as const;
const BROWSER_COMMAND = ['npm', 'run', 'test:cp-059-billing:browser'] as const;

export const MUTATIONS: readonly Mutation[] = [
  // ---- case normalisation: classification and validation must agree ----
  //
  // Review found the aggregates lowercasing while the customer-safety gate compared RAW text
  // against the same lowercase list. line_type is a bare `text not null` with no lowercase
  // constraint, so a row spelled RETURN_LABEL was counted as return postage AND skipped postage
  // validation — unvalidated money on a customer's invoice through capitalisation alone. Both
  // sides now share one helper; dropping lower() from it must go red.
  {
    label: 'CASE: drop lower() from the shared return line-type predicate',
    file: TYPES, guard: VOCAB_PARITY, command: VOCAB_PARITY_COMMAND,
    from: "  return sql`lower(coalesce(${lineType}, '')) in (${sql.join(",
    to: "  return sql`coalesce(${lineType}, '') in (${sql.join(",
  },
  {
    label: 'VOCAB PARITY: file return_label under processing instead of postage',
    file: TYPES, guard: VOCAB_PARITY, command: VOCAB_PARITY_COMMAND,
    from: "export const RETURN_POSTAGE_LINE_TYPES = ['return_postage', 'return_label'] as const;",
    to: "export const RETURN_POSTAGE_LINE_TYPES = ['return_postage'] as const as readonly ['return_postage', 'return_label'];",
  },
  // ---- the return vocabulary itself ----
  //
  // Review found RETURN_LINE_TYPES covering only the two MODERN spellings, so the canonical
  // return total computed /usr/bin/bash.00 for the legacy shapes it existed to fix. Each removal below is
  // that defect, one line type at a time.
  {
    label: 'VOCAB: drop the bare return type (the legacy shape that funds returnTotal alone)',
    file: TYPES, guard: CONTRACT,
    from: "export const RETURN_BARE_LINE_TYPES = ['return'] as const;",
    to: "export const RETURN_BARE_LINE_TYPES = [] as const as readonly ['return'];",
  },
  {
    label: 'VOCAB: drop the legacy return_label postage alias',
    file: TYPES, guard: CONTRACT,
    from: "export const RETURN_POSTAGE_LINE_TYPES = ['return_postage', 'return_label'] as const;",
    to: "export const RETURN_POSTAGE_LINE_TYPES = ['return_postage'] as const as readonly ['return_postage', 'return_label'];",
  },
  {
    label: 'VOCAB: drop the legacy return_processing alias',
    file: TYPES, guard: CONTRACT,
    from: "export const RETURN_PROCESSING_LINE_TYPES = ['return_processing_fee', 'return_processing'] as const;",
    to: "export const RETURN_PROCESSING_LINE_TYPES = ['return_processing_fee'] as const as readonly ['return_processing_fee', 'return_processing'];",
  },
  {
    label: 'FIXTURE: hand-edit a producer amount without regenerating (contentHash must catch it)',
    file: 'fixtures/cp-059-producer-billing-rows.json', guard: CONTRACT,
    from: '\"returnTotal\": 10.73',
    to: '\"returnTotal\": 99.99',
  },
  // ---- CP-059 AC-6: each money category, hidden from each surface, independently ----
  //
  // Review found the grid omitting Adjustment, Return Total, Replacement Postage and
  // Replacement Pick & Pack while still printing a Fulfillment Fee that contained them, so a
  // row displayed components totalling $10.60 beside a $15.85 charge. These mutations reinstate
  // that defect one category and one surface at a time: any single category that can be hidden
  // without a guard going red is a category the customer can be charged for invisibly.
  {
    label: 'GRID: drop the Adjustment column (a credit vanishes from the row)',
    file: GRID, guard: BROWSER, command: BROWSER_COMMAND,
    from: "      'Adjustment',\n      120,\n      (row) => row.adjustmentTotal,",
    to: "      'Adjustment',\n      120,\n      () => null,",
  },
  {
    label: 'GRID: render Adjustment through moneyOrDash, so a negative credit shows as an em dash',
    file: GRID, guard: BROWSER, command: BROWSER_COMMAND,
    from: `      (row) => row.adjustmentTotal,
      // Signed: a credit is negative and must stay visible.
      signedMoneyOrDash,`,
    to: `      (row) => row.adjustmentTotal,
      moneyOrDash,`,
  },
  {
    label: 'GRID: drop the producer-owned Return Total column',
    file: GRID, guard: BROWSER, command: BROWSER_COMMAND,
    from: "      'Return Total',\n      120,\n      (row) => row.returnTotal,",
    to: "      'Return Total',\n      120,\n      () => null,",
  },
  {
    label: 'GRID: derive Return Total from its parts instead of rendering the producer value',
    file: GRID, guard: BROWSER, command: BROWSER_COMMAND,
    from: '      (row) => row.returnTotal,\n      signedMoneyOrDash,',
    to: '      (row) => numberValue(row.returnProcessingTotal) + numberValue(row.returnPostageTotal),\n      signedMoneyOrDash,',
  },
  {
    label: 'GRID: drop the Replacement Postage column',
    file: GRID, guard: BROWSER, command: BROWSER_COMMAND,
    from: '      (row) => row.replacePostageTotal,',
    to: '      () => null,',
  },
  {
    label: 'GRID: drop the Replacement Pick & Pack column',
    file: GRID, guard: BROWSER, command: BROWSER_COMMAND,
    from: '      (row) => row.replacePickPackTotal,',
    to: '      () => null,',
  },
  {
    label: 'HTML: blank the Adjustment cell on every printed row',
    file: HTML, guard: CONTRACT,
    from: '        <td class="num">${signedMoneyOrDash(detail.adjustmentTotal)}</td>',
    to: '        <td class="num"></td>',
  },
  {
    label: 'HTML: blank the Return Total cell on every printed row',
    file: HTML, guard: CONTRACT,
    from: '        <td class="num">${moneyOrDash(detail.returnTotal)}</td>',
    to: '        <td class="num"></td>',
  },
  {
    label: 'HTML: blank the Replacement Postage cell on every printed row',
    file: HTML, guard: CONTRACT,
    from: '        <td class="num">${moneyOrDash(detail.replacePostageTotal)}</td>',
    to: '        <td class="num"></td>',
  },
  {
    label: 'HTML: blank the Replacement Pick & Pack cell on every printed row',
    file: HTML, guard: CONTRACT,
    from: '        <td class="num">${moneyOrDash(detail.replacePickPackTotal)}</td>',
    to: '        <td class="num"></td>',
  },
  {
    label: 'HTML: re-derive the footer Return Total by adding its two named parts',
    file: HTML, guard: CONTRACT,
    from: '        <td class="num">${money(invoiceTotals.returnTotal)}</td>',
    to: '        <td class="num">${money(invoiceTotals.returnProcessingTotal + invoiceTotals.returnPostageTotal)}</td>',
  },
  {
    label: 'XLSX: zero the Adjustment cell on every exported row',
    file: XLSX, guard: CONTRACT,
    from: '    { type: Number, value: num(r.adjustmentTotal), format: MONEY_FORMAT },',
    to: '    { type: Number, value: 0, format: MONEY_FORMAT },',
  },
  {
    label: 'XLSX: zero the Return Total cell on every exported row',
    file: XLSX, guard: CONTRACT,
    from: '    { type: Number, value: num(r.returnTotal), format: MONEY_FORMAT },',
    to: '    { type: Number, value: 0, format: MONEY_FORMAT },',
  },
  {
    label: 'XLSX: zero the Replacement Postage cell on every exported row',
    file: XLSX, guard: CONTRACT,
    from: '    { type: Number, value: num(r.replacePostageTotal), format: MONEY_FORMAT },',
    to: '    { type: Number, value: 0, format: MONEY_FORMAT },',
  },
  {
    label: 'XLSX: zero the Replacement Pick & Pack cell on every exported row',
    file: XLSX, guard: CONTRACT,
    from: '    { type: Number, value: num(r.replacePickPackTotal), format: MONEY_FORMAT },',
    to: '    { type: Number, value: 0, format: MONEY_FORMAT },',
  },
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
    from: '  if (canonicalEventId === null || clientId === null || !orderIdValid || !rowTypeValid || !destinationValid',
    to: '  if (asInteger(row.orderId) === null ||canonicalEventId === null || clientId === null || !orderIdValid || !rowTypeValid || !destinationValid',
  },

  // ---- identity ----
  {
    label: 'identity: stop requiring canonicalEventId, so an identity-less row is accepted',
    // BOUNDARY, not CONTRACT: every row in the producer fixture already carries an identity, so
    // the contract guard cannot see this break. The boundary guard asserts the rejection directly.
    file: PROXY, guard: BOUNDARY,
    from: 'canonicalEventId === null || clientId === null ||',
    to: 'clientId === null ||',
  },
  {
    label: 'identity: sort tiebreak goes back to orderId|returnId|rowType, collapsing storage rows',
    file: EVENTS, guard: SORT,
    from: '  return row.canonicalEventId;',
    to: "  return `${row.orderId ?? ''}|${row.returnId ?? ''}|${row.rowType ?? ''}`;",
  },

  {
    // The bug that shipped in this very PR: the projection is an allowlist, and a field nobody
    // names is a field silently dropped. Only CI caught it, because the projection was inline in
    // a database-bound function and no static guard could reach it.
    label: 'identity: the served DTO projection drops canonicalEventId (frontend loses all identity)',
    file: EVENTS, guard: CONTRACT,
    from: '      canonicalEventId: row.canonicalEventId,\n',
    to: '',
  },

  {
    label: 'identity: accept any non-empty string as an identity (so "x" passes)',
    file: PROXY, guard: BOUNDARY,
    from: "    && CANONICAL_EVENT_ID_PATTERN.test(row.canonicalEventId)\n",
    to: '',
  },
  {
    label: 'identity: allow duplicate canonicalEventId across one response (two charges, one row)',
    file: PROXY, guard: BOUNDARY,
    from: '    if (seen.has(id)) {',
    to: '    if (false) {',
  },
  {
    label: 'identity: React key falls back to the collapsing orderId/rowType/returnId key',
    file: ROWS, guard: CONTRACT,
    from: 'export const invoiceRowKey = (row: BillingInvoiceDetailRow): string => row.canonicalEventId;',
    to: 'export const invoiceRowKey = (row: BillingInvoiceDetailRow): string => String(row.orderId) + String(row.rowType);',
  },
  {
    // Targets relationalIdValid, not asInteger. asInteger's integer check became a second
    // layer once relationalIdValid was added, and a mutation of a redundant layer is not
    // observable — the same trap PS-512 hit with the cancelled zeroing. This breaks the layer
    // that actually decides.
    label: 'ids: accept a fractional relational id instead of rejecting it (42.9 points at another order)',
    file: PROXY, guard: BOUNDARY,
    from: "    return typeof value === 'number' && Number.isInteger(value);",
    to: '    return asNumber(value) !== null;',
  },
  {
    label: 'money: accept a numeric STRING for a producer-declared number field',
    file: PROXY, guard: BOUNDARY,
    from: '    return typeof value === \'number\' && Number.isFinite(value);',
    to: '    return asNumber(value) !== null;',
  },
  {
    label: 'scope: stop requiring clientId, silently detaching a line from its client',
    file: PROXY, guard: BOUNDARY,
    from: 'clientId === null || !orderIdValid ||',
    to: '',
  },
  {
    label: 'projection: drop adjustmentTotal from the served DTO',
    file: EVENTS, guard: CONTRACT,
    from: '      adjustmentTotal: row.adjustmentTotal,\n',
    to: '',
  },
  {
    label: 'PS-512: replacement money dropped from the served DTO, so it renders as nothing',
    file: EVENTS, guard: CONTRACT,
    from: '      replacePostageTotal: row.replacePostageTotal,\n',
    to: '',
  },

  // ---- producer-guaranteed money ----
  {
    label: 'money: stop requiring the producer-guaranteed totals, so a row with no grandTotal prints $0.00',
    file: PROXY, guard: BOUNDARY,
    from: '  const moneyValid = REQUIRED_NUMBER_FIELDS.every((field) => {',
    to: '  const moneyValid = true; void ((field: string) => {',
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
function commandFor(mutation: Pick<Mutation, 'guard' | 'command'>): readonly string[] {
  return mutation.command ?? ['npx', 'tsx', mutation.guard];
}

function runGuard(command: readonly string[]): void {
  const [bin, ...args] = command;
  execFileSync(bin, args, { stdio: 'pipe', shell: process.platform === 'win32' });
}

function assertBaselineGreen(mutations: readonly Mutation[]): void {
  const seen = new Map<string, readonly string[]>();
  for (const mutation of mutations) seen.set(mutation.guard, commandFor(mutation));
  const red: string[] = [];
  for (const [guard, command] of seen) {
    try {
      runGuard(command);
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
  console.log(`baseline: all ${seen.size} guards green before mutating\n`);
}

function run(): number {
  assertBaselineGreen(MUTATIONS);
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
      runGuard(commandFor(mutation));
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
