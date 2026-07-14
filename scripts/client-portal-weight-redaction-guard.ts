import { readActiveClientPortalApiSource } from './lib/client-portal-active-api-source.mjs';
import { readSourceTree } from './lib/source-tree.mjs';
// Client Portal: Weight is operator-visible only. Admin/global users may add
// it to the Orders table through column customization, but client users must
// never receive or render order/package weight in customer-facing surfaces.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
let failed = false;

function check(condition: boolean, message: string) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    failed = true;
  } else {
    console.log(`ok: ${message}`);
  }
}

const pkg = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };
const orders = read('portal-client/src/pages/Orders.tsx');
const inventory = read('portal-client/src/pages/Inventory.tsx');
const shipments = read('portal-client/src/pages/Shipments.tsx');
const orderDetailPanel = read('portal-client/src/components/OrderDetailPanel.tsx');
const orderDetailLoader = read('portal-client/src/components/OrderDetailLoader.tsx');
const api = readActiveClientPortalApiSource();
const dto = read('src/lib/client-portal/dto.ts');
const ordersReadModel = read('src/lib/client-portal/read-models/orders.ts');
const dataTable = readSourceTree([
  'portal-client/src/components/ui/DataTable.tsx',
  'portal-client/src/components/ui/data-table',
]);
const columnLayout = read('portal-client/src/lib/useColumnLayout.ts');

check(
  pkg.scripts?.['test:client-portal-weight-redaction'] ===
    'tsx scripts/client-portal-weight-redaction-guard.ts',
  'package.json exposes test:client-portal-weight-redaction',
);

check(
  /defaultHidden\?:\s*boolean/.test(dataTable) &&
    /defaultHidden\?:\s*boolean/.test(columnLayout) &&
    /defaultHidden/.test(columnLayout),
  'DataTable supports default-hidden columns so admin-only Weight can live in the chooser',
);

check(
  /useCanCustomizeTables/.test(orders) &&
    /const canCustomizeTables = useCanCustomizeTables\(\);/.test(orders) &&
    /allowColumnCustomization=\{canCustomizeTables\}/.test(orders),
  'Orders table customization is explicitly gated through the shared admin/global table gate',
);

check(
  orders.includes("header: 'Weight'") &&
    orders.includes("key: 'weight'") &&
    orders.includes('defaultHidden: true') &&
    orders.includes('fmtWeight') &&
    orders.includes('weightOz') &&
    /\.\.\.\(canCustomizeTables\s*\?\s*\[/.test(orders),
  'Orders page defines Weight as a default-hidden admin-only customizable column',
);

check(
  !inventory.includes("header: 'Weight'") &&
    !inventory.includes("key: 'weight'") &&
    !inventory.includes('fmtWeight') &&
    !inventory.includes('weightOz'),
  'Inventory page does not render or format Weight',
);

check(
  !shipments.includes('hideWeight') &&
    !shipments.includes('label="Weight"') &&
    !shipments.includes('weightOz'),
  'Shipments page does not carry Weight display plumbing',
);

check(
  !orderDetailPanel.includes('label="Weight"') &&
    !orderDetailPanel.includes('fmtWeight') &&
    !orderDetailPanel.includes('hideWeight') &&
    !orderDetailPanel.includes('Package') &&
    !orderDetailPanel.includes('weightOz'),
  'Order detail panel does not render or format Weight',
);

check(
  !orderDetailLoader.includes('hideWeight'),
  'Order detail loader has no Weight visibility props',
);

check(
  /weightOz\?:\s*number\s*\|\s*string\s*\|\s*null/.test(api),
  'frontend API type exposes weightOz as optional admin-only order data',
);

check(
  /includeWeight\?:\s*boolean/.test(dto) &&
    /options\.includeWeight/.test(dto) &&
    /weightOz:\s*row\.weightOz\s*\?\?\s*null/.test(dto) &&
    !dto.includes('rateWeightOz'),
  'client-portal order DTO exposes canonical orders.weightOz only when includeWeight is true',
);

check(
  /includeWeight:\s*scope\.isGlobal/.test(ordersReadModel),
  'orders read-model only includes weight for global/admin portal scope',
);

if (failed) process.exit(1);
console.log('\nclient portal weight redaction guard passed.');
