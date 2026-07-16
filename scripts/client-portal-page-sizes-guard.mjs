import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const checks = [];
const check = (ok, message) => checks.push({ ok, message });

const pagination = read('portal-client/src/components/ui/Pagination.tsx');
const orders = read('portal-client/src/pages/Orders.tsx');
const shipments = read('portal-client/src/pages/Shipments.tsx');
const returns = read('portal-client/src/pages/Returns.tsx');
const inbound = read('portal-client/src/pages/Inbound.tsx');
const inventory = read('portal-client/src/pages/Inventory.tsx');
const invoices = read('portal-client/src/pages/Invoices.tsx');
const invoiceLines = read('portal-client/src/components/billing/invoices/InvoiceLineItems.tsx');
const inboundReceipts = read('portal-client/src/components/inbound/useInboundReceipts.ts');
const hooks = read('portal-client/src/lib/hooks.ts');
const inventoryApi = read('portal-client/src/lib/api/domains/inventory.ts');
const queryParams = read('src/lib/client-portal/query-params.ts');

check(
  pagination.includes('const PAGE_SIZE_OPTIONS = [50, 100, 200, 300, 500] as const;'),
  'shared pagination offers exactly 50, 100, 200, 300, and 500 rows',
);
check(
  pagination.includes('aria-label="Rows per page"') && pagination.includes('onPageSize(Number(event.target.value))'),
  'shared pagination exposes an accessible page-size selector',
);
check(
  /parsePageSize\(value: string \| undefined, fallback = 25, max = 500\)/.test(queryParams),
  'backend accepts the 500-row Client Portal option',
);

for (const [name, source, queryPattern] of [
  ['Orders', orders, /useOrders\(\{[^}]*pageSize/],
  ['Shipments', shipments, /useShipments\(\{[^}]*pageSize/],
  ['Returns', returns, /useReturns\(\{[^}]*pageSize/],
  ['Inbound receipts', inbound, /useInboundReceipts\([^)]*receiptPageSize/],
  ['Inventory stock', inventory, /useInventory\(\{[^}]*pageSize/],
  ['Inventory history', inventory, /useInventoryHistory\(\{[^}]*pageSize/],
  ['Invoice lines', invoices, /useInvoiceDetailsRange\([\s\S]*?detailPageSize/],
]) {
  check(queryPattern.test(source), `${name} sends the selected page size to its query`);
}

check((inventory.match(/onPageSize=/g) ?? []).length === 2, 'both Inventory pagers expose page-size selection');
for (const [name, source] of [
  ['Orders', orders],
  ['Shipments', shipments],
  ['Returns', returns],
  ['Inbound receipts', inbound],
  ['Invoice lines', invoiceLines],
]) {
  check(source.includes('onPageSize='), `${name} pager exposes page-size selection`);
}

check(
  inboundReceipts.includes("effectiveClientId ?? 'scope', page, pageSize") && inboundReceipts.includes('{ clientId: effectiveClientId, page, pageSize }'),
  'Inbound receipt cache key and request include page size',
);
for (const key of ["['shipments'", "['inventory'", "['inventory-history'", "['returns'"]) {
  const line = hooks.split('\n').find((value) => value.includes(key)) ?? '';
  check(line.includes('pageSize'), `${key.slice(2, -1)} cache key includes page size`);
}
check(inventoryApi.includes('pageSize: opts.pageSize ?? 50'), 'Inventory history API forwards page size');
check(
  shipments.includes('ids.slice(index, index + 100)'),
  '500-row shipment pages retain live tracking refresh through safe 100-row batches',
);

const failures = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'}: ${item.message}`);
if (failures.length) process.exit(1);
