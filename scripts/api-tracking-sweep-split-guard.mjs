import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Incident 2026-08-12: every authenticated /api/client-portal/* request hung
// until the browser aborted at 30s, so the portal rendered loading skeletons
// forever. Root cause: the shipment tracking sweep was running inside the API
// process. The sweep makes external carrier calls (USPS/ShipStation) for a
// batch of 500 shipments every 3 minutes and writes results through the shared
// request pool (DB_POOL_MAX, default 4). A stalled carrier call left pooled
// connections pinned 'active'/'ClientRead' — one survived 64 minutes — and
// postgres.js queues connection acquisition with no timeout, so every request
// that needed a connection waited forever.
//
// CLIENT_PORTAL_ONLY_API already disabled the sync scheduler on the API, but
// the sweep sat outside that branch and escaped the runtime split entirely.
// The Worker starts the sweep unconditionally (worker.ts), so an API process
// serving client-portal traffic must never start a second copy.

const main = readFileSync('src/main.ts', 'utf8');
const worker = readFileSync('src/worker.ts', 'utf8');

assert(
  worker.includes('startShipmentTrackingSweep()'),
  'the Render Worker must own the shipment tracking sweep',
);

assert(
  main.includes('clientPortalOnly && env.RUN_SHIPMENT_TRACKING_SWEEP'),
  'the API must refuse to start the shipment tracking sweep while it serves client-portal traffic',
);

const sweepCall = main.indexOf('startShipmentTrackingSweep()');
assert(sweepCall !== -1, 'src/main.ts must still reference the tracking sweep');

const guardClause = main.indexOf('clientPortalOnly && env.RUN_SHIPMENT_TRACKING_SWEEP');
assert(
  guardClause < sweepCall,
  'the client-portal split check must come before the tracking sweep starts',
);

console.log('PASS api tracking sweep split guard');
