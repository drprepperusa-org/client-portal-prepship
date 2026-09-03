// #1532 — the portal renders the return identity PrepShip emits, bare, on one grain.
//
// DJ's rulings (2026-09-03): the identity of a billing row is the portal-minted STORED
// return_reference (2050-RETURN, 2050-RETURN-2) or the order number (2050), bare. A '#' is a
// per-surface convention that PrepShip's operator table adds for itself; the customer exports
// and this portal render the bare value. The portal never mints, strips or prefixes anything,
// and its detail grain is PrepShip's canonical billing EVENTS — one Outbound row and one Return
// row per order with a return — where the total is the length of the very array the rows come
// from. This guard holds those three facts against the real files:
//   1. the grid's Reference cell and the printable invoice render displayReference verbatim
//      and contain no '#' prefix, not even on the orderless fallback;
//   2. the contract documents the bare form and forbids local minting;
//   3. the order-grain count read model is gone and nothing calls it; the canonical events
//      read model's total is the row array's length.
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}\n  ${error.message}`);
  }
}

const COLUMNS = 'portal-client/src/components/billing/invoiceColumns.tsx';
const HTML = 'src/lib/client-portal/invoice-html.ts';
const CONTRACT = 'src/lib/client-portal/contracts/billing.ts';
const READ_MODEL = 'src/lib/client-portal/read-models/invoice-details.ts';
const EVENTS = 'src/lib/client-portal/read-models/canonical-invoice-events.ts';
const ROUTE = 'src/routes/client-portal/invoices.ts';

check('the grid Reference cell renders displayReference first, then the order number, then the bare id', () => {
  const src = code(read(COLUMNS));
  assert.match(src, /const label = row\.displayReference\s*\?\? row\.orderNumber\s*\?\? \(row\.orderId \? String\(row\.orderId\) : '—'\);/, 'label chain');
  assert.doesNotMatch(src, /`#\$\{/, 'a \'#\' prefix is assembled in the grid');
  assert.doesNotMatch(src, /-RETURN/, 'the grid knows the suffix (it must not)');
});
check('the printable invoice renders displayReference verbatim with no prefix', () => {
  const src = code(read(HTML));
  assert.match(src, /escHtml\(detail\.displayReference \?\? detail\.orderNumber \?\? detail\.orderId \?\? ''\)/, 'reference cell');
  assert.doesNotMatch(src, /`#\$\{|'#' \+|"#" \+/, 'a \'#\' prefix is assembled in the invoice');
  assert.doesNotMatch(src, /-RETURN/, 'the invoice knows the suffix (it must not)');
});
check('the contract documents the bare form and forbids local minting', () => {
  const src = read(CONTRACT);
  assert.match(src, /\/\*\* e\.g\. 1234, 1234-RETURN, 1234-RETURN-2\. Rendered verbatim, never minted locally\. \*\/\s*displayReference\?: string \| null;/);
});
check('the order-grain count read model is retired and nothing calls it', () => {
  assert.doesNotMatch(code(read(READ_MODEL)), /portalInvoiceDetailCount/, 'still declared');
  assert.doesNotMatch(code(read(ROUTE)), /portalInvoiceDetailCount/, 'still referenced by the route');
});
check('the canonical events read model counts the rows it serves (total = all.length)', () => {
  const src = code(read(EVENTS));
  assert.match(src, /const total = all\.length;/);
  assert.match(src, /return \{ ok: true, rows, total, totals: upstream\.totals \};/);
});
check('the portal never mints a return suffix anywhere in its src', () => {
  // The only place the literal may live is the portal's own reference MINTER for the Returns
  // workflow (return-reference.ts / returns/shared.ts), which is upstream of billing.
  const hits = execSync('git grep -l -- "-RETURN" -- src portal-client/src', { cwd: root }).toString().trim().split('\n').filter(Boolean);
  const allowed = new Set(['src/services/return-reference.ts', 'src/routes/client-portal/returns/shared.ts', 'src/lib/client-portal/contracts/billing.ts']);
  // Prose may name the suffix (contracts, schema notes, this guard's own comments); CODE may not.
  const stray = hits.filter((f) => !allowed.has(f) && /-RETURN/.test(code(read(f))));
  assert.deepEqual(stray, [], `-RETURN literal outside the minter/contract: ${stray.join(', ')}`);
});

console.log(`\n#1532 return identity display guard: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
