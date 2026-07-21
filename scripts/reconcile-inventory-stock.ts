/**
 * PS-439 retired Client Portal's former cache/order-derived reconciliation.
 * Inventory discrepancy ownership lives in PrepShip's canonical read-only audit.
 */
console.error(
  'PS439_RECONCILIATION_RETIRED: run `npm run audit:ps-439-inventory-discrepancies` in the PrepShip repository; no Client Portal report or mutation ran.',
);
process.exitCode = 1;
