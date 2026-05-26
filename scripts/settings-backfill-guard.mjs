import fs from 'node:fs';

const checks = [
  {
    file: 'src/routes/sync.ts',
    required: [
      "app.post('/backfill'",
      "requirePermission('settings:write')",
      "'inventory-from-orders'",
      'syncShipments',
      'importSkusFromOrders',
      'syncShipStationProducts',
    ],
  },
  {
    file: 'web/src/lib/api.ts',
    required: ['BackfillTarget', 'BackfillMode', "portalApi", "backfill(token", "'/sync/backfill'"],
  },
  {
    file: 'web/src/lib/portalQueries.ts',
    required: ['useSyncStatusQuery', 'useBackfillMutation', 'demoBackfillResponse', 'portalQueryKeys.syncStatus'],
  },
  {
    file: 'web/src/pages/Settings.tsx',
    required: [
      'Backfill',
      'Backfill sync',
      'Run all backfill tasks',
      'Inventory from orders',
      'Product catalog',
      'settings:write',
    ],
  },
];

let failed = false;

for (const check of checks) {
  const source = fs.readFileSync(check.file, 'utf8');
  for (const needle of check.required) {
    if (!source.includes(needle)) {
      console.error(`[settings-backfill-guard] Missing "${needle}" in ${check.file}`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log('[settings-backfill-guard] Settings backfill route and UI checks passed.');
