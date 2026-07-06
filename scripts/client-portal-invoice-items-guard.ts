// CP-004 guard: Client Portal invoice item names are backend-owned,
// quantity-aware, and rendered with line breaks in active invoice surfaces.
import fs from 'node:fs';
import path from 'node:path';

type InvoiceItemLine = {
  name?: string | null;
  quantity?: number | string | null;
  lineIndex?: number | null;
  unitPrice?: number | string | null;
};

const root = process.cwd();
let failed = false;

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    failed = true;
  } else {
    console.log(`ok: ${message}`);
  }
}

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const invoiceItems = read('src/lib/client-portal/invoice-items.ts');
const activeInvoices = read('portal-client/src/pages/Invoices.tsx');
const legacyInvoices = read('web/src/pages/Invoices.tsx');
const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };

// B1 moved the invoice-details read-model and the printable invoice HTML out
// of routes/client-portal.ts; assert over their new homes so coverage follows
// the code (the old route regexes matched nothing after the extraction).
const invoiceDetailsBlock = read('src/lib/client-portal/read-models/invoice-details.ts');
const printableInvoiceBlock = read('src/lib/client-portal/invoice-html.ts');

assert(
  pkg.scripts?.['test:client-portal-invoice-items'] === 'tsx scripts/client-portal-invoice-items-guard.ts',
  'package.json exposes test:client-portal-invoice-items',
);

let formatInvoiceItemNameLines:
  | ((items: InvoiceItemLine[]) => string | null)
  | undefined;

try {
  const module = await import('../src/lib/client-portal/invoice-items');
  formatInvoiceItemNameLines = module.formatInvoiceItemNameLines;
  assert(typeof formatInvoiceItemNameLines === 'function', 'invoice item name formatter is exported from backend lib');
} catch (err) {
  assert(false, `invoice item name formatter can be imported (${err instanceof Error ? err.message : String(err)})`);
}

if (formatInvoiceItemNameLines) {
  assert(
    formatInvoiceItemNameLines([
      { name: 'Booster Gel', quantity: '1.000', lineIndex: 2 },
      { name: 'Leeds Line V2', quantity: 1, lineIndex: 3 },
      { name: 'Booster Gel', quantity: '1', lineIndex: 4 },
    ]) === 'Booster Gel x2\nLeeds Line V2 x1',
    'formatter aggregates duplicate names, sums quantities, and preserves first line order',
  );

  assert(
    formatInvoiceItemNameLines([
      { name: 'Ignored zero', quantity: 0, lineIndex: 1 },
      { name: 'Ignored negative', quantity: -1, lineIndex: 2 },
      { name: 'Sample Pack', quantity: '1.500', lineIndex: 3 },
      { name: '   ', quantity: 2, lineIndex: 4 },
    ]) === 'Sample Pack x1.5',
    'formatter ignores empty/non-positive item rows and uses clean decimal quantities',
  );

  assert(
    formatInvoiceItemNameLines([
      { name: 'Booster Gel', quantity: 2, unitPrice: '9.99', lineIndex: 1 },
      { name: 'WELCOME10', quantity: 1, unitPrice: '-10.00', lineIndex: 2 },
    ]) === 'Booster Gel x2',
    'formatter excludes negative-price discount/promo lines from invoice item quantities',
  );
}

assert(
  !invoiceDetailsBlock.includes("string_agg(distinct oi.name, ' | ')"),
  'portalInvoiceDetails no longer returns pipe-delimited distinct bare item names',
);
assert(
  invoiceDetailsBlock.includes('invoiceItemNameLinesSql') &&
    /string_agg\([\s\S]*chr\(10\)/.test(invoiceItems) &&
    invoiceItems.includes(' x') &&
    invoiceItems.includes('sum(greatest(0, coalesce(oi.quantity, 0)))') &&
    invoiceItems.includes('coalesce(oi.unit_price, 0) >= 0'),
  'portalInvoiceDetails builds newline-separated Name xQty lines from order_items.quantity',
);
assert(
  /select sum\(greatest\(0, coalesce\(oi\.quantity, 0\)\)[\s\S]*coalesce\(oi\.unit_price, 0\) >= 0[\s\S]*as qty/.test(invoiceDetailsBlock),
  'portalInvoiceDetails Qty excludes negative-price discount/promo lines so it reconciles to displayed item quantities',
);
assert(
  invoiceItems.includes('min(oi.line_index') || invoiceItems.includes('min(coalesce(oi.line_index'),
  'portalInvoiceDetails uses original order item line order for stable item-name lines',
);

assert(
  printableInvoiceBlock.includes('.item-name { white-space: pre-line; }') &&
    printableInvoiceBlock.includes('const skus = detail.skus ?? detail.itemNames ??') &&
    printableInvoiceBlock.includes('<td class="mono item-name">${escHtml(skus)}</td>'),
  'backend printable invoice uses SKU(s) first while preserving itemNames line breaks as fallback',
);

// CP-007: the Billing line-items table renders structured SKU lines via the
// shared ItemIdentityLines component (qty-aware, one line per SKU). The
// separate Item Name column was intentionally removed from the client billing
// standard; rows with no structured SKUs still fall back to itemNames.
assert(
  !activeInvoices.includes("header: 'Item Name'") &&
    activeInvoices.includes('<SkuLines items={r.items}') &&
    activeInvoices.includes('r.skus ?? r.itemNames'),
  'active portal invoice item cell renders a structured qty-aware SKU(s) column with itemNames fallback',
);

assert(
  legacyInvoices.includes('whitespace-pre-line') &&
    legacyInvoices.includes('.item-name{white-space:pre-line}') &&
    legacyInvoices.includes('<td class="item-name">${escapeHtml(row.itemNames ?? \'\')}</td>'),
  'legacy/adjusted invoice preview preserves the same itemNames line breaks',
);

if (failed) process.exit(1);
console.log('\nCP-004 client portal invoice item-name guard passed.');
