/**
 * PS-439 retired Client Portal's shipped-order inventory backfill. Historical
 * quantity repair requires PrepShip's read-only discrepancy report followed by
 * a separately reviewed append-only movement plan.
 * Per user override unlock shipped data on 2026-07-21.
 */
console.error(
  'PS439_BACKFILL_RETIRED: no shipped orders or inventory movements were changed.',
);
process.exitCode = 1;
