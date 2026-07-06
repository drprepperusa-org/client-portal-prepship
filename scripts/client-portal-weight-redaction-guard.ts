// Client Portal: Weight is not a customer-visible field in any portal UI.
// Backend DTOs may still carry weight for operational workflows, but the
// client-portal frontend must not expose, render, or format it.
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
const api = read('portal-client/src/lib/api.ts');

check(
  pkg.scripts?.['test:client-portal-weight-redaction'] ===
    'tsx scripts/client-portal-weight-redaction-guard.ts',
  'package.json exposes test:client-portal-weight-redaction',
);

check(
  !orders.includes("header: 'Weight'") &&
    !orders.includes("key: 'weight'") &&
    !orders.includes('fmtWeight') &&
    !orders.includes('weightOz'),
  'Orders page does not render or format Weight',
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
  !api.includes('weightOz'),
  'frontend API types do not expose weightOz to Client Portal UI code',
);

if (failed) process.exit(1);
console.log('\nclient portal weight redaction guard passed.');
