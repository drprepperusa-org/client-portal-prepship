#!/usr/bin/env tsx
/**
 * CP-069 — cross-repo ORDER-LIFECYCLE display PARITY test (real provider functions).
 *
 * The static gate (scripts/prepship-order-lifecycle-parity.mjs) proves the portal's port still
 * spells PrepShip's pinned text. This proves the other half: the CURRENT PrepShip owner and the
 * CURRENT Client Portal port AGREE today, as running code. It imports PrepShip's REAL
 * orderLifecycleEffectiveStatusSql / orderLifecycleEffectiveStatusAliasSql /
 * resolveOrderLifecycleStatus / resolveShippedLabelDisplayState from the sibling prepship-v4
 * checkout and asserts:
 *   1. the PgDialect-rendered SQL of PrepShip's and the portal's effective-status CASE is
 *      identical (table form and alias form), and both equal the pinned canonical text;
 *   2. over the FULL input matrix, portal.resolveOrderFulfillmentStatus(...) equals the pinned
 *      projection of PS.resolveOrderLifecycleStatus(...).orderLifecycleStatus, where the display
 *      state fed to PrepShip is PrepShip's own resolveShippedLabelDisplayState, gated on
 *      PrepShip's effective status === 'shipped' exactly as routes/orders.ts gates it;
 *   3. the sibling checkout's three owner blobs are the ones the contract pins.
 * Both exact SHAs are printed.
 *
 * Ownership: CP owns this (the consumer asserts compatibility with its provider). The sibling
 * checkout is resolved as PREPSHIP_V4_DIR (relative to cwd) or ../prepship-v4, which is how the
 * CI workflow lays the two repos out. Offline: no DB, no network — fake env is set before the PS
 * service tree loads so an import cannot reach a real credential.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
// CP's own port lives inside CP's rootDir — normal static imports are correct here.
import {
  orderLifecycleEffectiveStatusSql,
  orderLifecycleEffectiveStatusAliasSql,
  resolvePortalOrderFulfillmentBucket,
} from '../../src/lib/client-portal/order-lifecycle';
import { resolveOrderFulfillmentStatus } from '../../src/lib/client-portal/order-status';

process.env.VERCEL = '1';
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgres://cp069:cp069@127.0.0.1:1/cp069_parity';
process.env.SUPABASE_URL = 'https://cp069-parity.supabase.invalid';
process.env.SUPABASE_ANON_KEY = 'cp069-parity-anon-not-real';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'cp069-parity-service-not-real';
process.env.SUPABASE_JWT_SECRET = 'cp069-parity-jwt-not-real';

// Local mirror of the PrepShip provider surface. The parity assertions below are what actually
// keep this in sync with PS; these local types only let CP's own strict typecheck stay green
// WITHOUT pulling PS's source tree into CP's program.
type PsLifecycleInput = {
  orderStatus?: string | null;
  canonicalStatus?: string | null;
  externallyShipped?: boolean | null;
  shippedLabelDisplayState?: string | null;
};
type PsLifecycleResult = { effectiveOrderStatus: string; orderLifecycleStatus: string };
type PsLifecycleModule = {
  orderLifecycleEffectiveStatusSql: () => unknown;
  orderLifecycleEffectiveStatusAliasSql: (alias: string) => unknown;
  resolveOrderLifecycleStatus: (input: PsLifecycleInput) => PsLifecycleResult;
};
type PsDisplayInput = {
  externallyShipped: boolean;
  externallyFulfilled: boolean | null;
  hasActiveShipment: boolean;
  hasExternalShipment?: boolean;
  hasVoidedShipment: boolean;
};
type PsDisplayModule = { resolveShippedLabelDisplayState: (input: PsDisplayInput) => string };

type Contract = {
  upstream: { ref: string; files: Record<string, { path: string; blobSha: string }> };
  effectiveStatusCase: { canonical: string };
  projection: Record<string, string>;
  portalStatuses: string[];
};
const contract = JSON.parse(
  readFileSync(resolve(process.cwd(), 'contracts/prepship-order-lifecycle-display.json'), 'utf8'),
) as Contract;

// The sibling checkout. Assembled at runtime and imported through a file URL, deliberately NOT a
// bare string literal: a literal specifier makes CP's ordinary `tsc` statically resolve it and
// drag the entire PS source tree into CP's program (TS6059/rootDir with a sibling present,
// TS2307 without one). tsx resolves the sibling .ts and PS's own deps at run time.
const psDir = resolve(process.cwd(), process.env.PREPSHIP_V4_DIR ?? '../prepship-v4');
const psFile = (segments: string[]): string => resolve(psDir, ...segments);
const lifecyclePath = psFile(['src', 'services', 'order-lifecycle-status.ts']);
const displayPath = psFile(['src', 'services', 'shipping-workflow', 'shipped-label-display-state.ts']);
if (!existsSync(lifecyclePath) || !existsSync(displayPath)) {
  console.error(
    `FAIL prepship-v4 sibling checkout not found at ${psDir} ` +
      '(set PREPSHIP_V4_DIR or check the provider out next to this repo)',
  );
  process.exit(1);
}
const ps = (await import(pathToFileURL(lifecyclePath).href)) as PsLifecycleModule;
const psDisplay = (await import(pathToFileURL(displayPath).href)) as PsDisplayModule;

function git(dir: string, args: string): string {
  try {
    return execSync(`git ${args}`, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}
const cpSha = git(process.cwd(), 'rev-parse HEAD');
const psSha = git(psDir, 'rev-parse HEAD');
console.log(`CP client-portal-prepship @ ${cpSha}`);
console.log(`PS prepship-v4            @ ${psSha}  (contract pins ${contract.upstream.ref})\n`);

let failures = 0;
function check(condition: boolean, message: string, detail?: string): void {
  if (condition) console.log(`  PASS ${message}`);
  else {
    console.error(`  FAIL ${message}${detail ? `\n       ${detail}` : ''}`);
    failures += 1;
  }
}

// ── 0. the sibling checkout carries the pinned owner blobs ─────────────────────────────────
for (const [key, pin] of Object.entries(contract.upstream.files)) {
  const blob = git(psDir, `rev-parse HEAD:${pin.path}`);
  check(
    blob === pin.blobSha,
    `sibling ${pin.path} is the pinned blob ${pin.blobSha.slice(0, 8)} (${key})`,
    `sibling blob ${blob} — re-pin contracts/prepship-order-lifecycle-display.json if the provider moved`,
  );
}

// ── 1. rendered SQL identity ───────────────────────────────────────────────────────────────
// One renderer for both expressions (CP's PgDialect, the same casing the app uses); drizzle's
// entity checks are symbol-keyed, so PS's SQL objects render through it exactly as PS's own
// dialect would.
const dialect = new PgDialect({ casing: 'snake_case' } as never);
const render = (query: unknown): string => dialect.sqlToQuery(query as SQL).sql;
const ws = (text: string): string => text.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
const bare = (text: string): string =>
  ws(text)
    .replace(/"orders"\."(order_status|canonical_status|externally_shipped)"/g, '$1')
    .replace(/\b[A-Za-z_][A-Za-z0-9_]*\.(order_status|canonical_status|externally_shipped)\b/g, '$1');

const psEffective = render(ps.orderLifecycleEffectiveStatusSql());
const cpEffective = render(orderLifecycleEffectiveStatusSql());
check(
  psEffective === cpEffective,
  'PgDialect renders PS and portal orderLifecycleEffectiveStatusSql() byte-identically',
  `PS: ${ws(psEffective)}\n       CP: ${ws(cpEffective)}`,
);
const psAlias = render(ps.orderLifecycleEffectiveStatusAliasSql('o'));
const cpAlias = render(orderLifecycleEffectiveStatusAliasSql('o'));
check(
  psAlias === cpAlias,
  "PgDialect renders PS and portal orderLifecycleEffectiveStatusAliasSql('o') byte-identically",
  `PS: ${ws(psAlias)}\n       CP: ${ws(cpAlias)}`,
);
check(
  bare(cpEffective) === bare(cpAlias) && bare(psEffective) === bare(psAlias),
  'table form and alias form are the same CASE once table/alias identifiers are normalised',
);
check(
  bare(cpEffective) === ws(contract.effectiveStatusCase.canonical) &&
    bare(psEffective) === ws(contract.effectiveStatusCase.canonical),
  'both rendered CASEs equal the canonical text pinned in the contract',
  `rendered: ${bare(cpEffective)}\n       pinned:   ${ws(contract.effectiveStatusCase.canonical)}`,
);

// ── 2. full input matrix: portal resolver === projection(PS lifecycle) ─────────────────────
const ORDER_STATUSES: Array<string | null> = [
  'awaiting_shipment', 'shipped', 'cancelled', 'on_hold', 'awaiting_payment', 'pending_fulfillment',
  '', null, 'refunded', 'canceled',
];
const CANONICAL_STATUSES: Array<string | null> = [
  null, '', 'shipped', 'shipped_pending_confirmation', 'confirmation_failed', 'cancelled', 'awaiting_shipment',
];
const EXTERNALLY_SHIPPED = [true, false];
const EXTERNALLY_FULFILLED: Array<boolean | null> = [true, false, null];
const HAS_ACTIVE = [true, false];
const HAS_VOIDED = [true, false];

type Mismatch = { input: string; psStatus: string; expected: string; portal: string };
const mismatches: Mismatch[] = [];
const seenPsStatuses = new Set<string>();
const unprojected = new Set<string>();
const bucketDisagreements: string[] = [];
let cells = 0;

for (const orderStatus of ORDER_STATUSES)
  for (const canonicalStatus of CANONICAL_STATUSES)
    for (const externallyShipped of EXTERNALLY_SHIPPED)
      for (const externallyFulfilled of EXTERNALLY_FULFILLED)
        for (const hasActive of HAS_ACTIVE)
          for (const hasVoided of HAS_VOIDED) {
            cells += 1;
            const base = { orderStatus, canonicalStatus, externallyShipped };
            // PrepShip's own gate (routes/orders.ts, orders-read-model.ts): the display state is
            // resolved only when the EFFECTIVE status is 'shipped', else null.
            const psEffectiveStatus = ps.resolveOrderLifecycleStatus({ ...base, shippedLabelDisplayState: null }).effectiveOrderStatus;
            const shippedLabelDisplayState =
              psEffectiveStatus === 'shipped'
                ? psDisplay.resolveShippedLabelDisplayState({
                    externallyShipped,
                    externallyFulfilled,
                    hasActiveShipment: hasActive,
                    hasVoidedShipment: hasVoided,
                  })
                : null;
            const psStatus = ps.resolveOrderLifecycleStatus({ ...base, shippedLabelDisplayState }).orderLifecycleStatus;
            seenPsStatuses.add(psStatus);
            const expected = contract.projection[psStatus];
            if (expected === undefined) {
              unprojected.add(psStatus);
              continue;
            }
            const portal = resolveOrderFulfillmentStatus({
              orderStatus,
              canonicalStatus,
              externallyShipped,
              externallyFulfilled,
              hasActiveOutboundShipment: hasActive,
              hasVoidedOutboundShipment: hasVoided,
            });
            const input =
              `orderStatus=${JSON.stringify(orderStatus)} canonical=${JSON.stringify(canonicalStatus)} ` +
              `externallyShipped=${externallyShipped} externallyFulfilled=${externallyFulfilled} ` +
              `hasActive=${hasActive} hasVoided=${hasVoided}`;
            if (portal !== expected) mismatches.push({ input, psStatus, expected, portal });

            // Bucket-level twin agreement: PS's effectiveOrderStatus and the portal's bucket twin.
            const psBucket =
              psEffectiveStatus === 'cancelled' ? 'cancelled' : psEffectiveStatus === 'shipped' ? 'shipped' : 'pending';
            const cpBucket = resolvePortalOrderFulfillmentBucket(base);
            if (psBucket !== cpBucket) bucketDisagreements.push(`${input} -> PS ${psBucket}, portal ${cpBucket}`);
          }

check(cells === 1680, `the full input matrix was exercised (${cells} cells)`);
check(
  unprojected.size === 0,
  'every PrepShip lifecycle status observed has a pinned projection',
  `unprojected: ${[...unprojected].join(', ')}`,
);
check(
  bucketDisagreements.length === 0,
  "the portal bucket twin agrees with PS effectiveOrderStatus on every cell (cancelled / shipped / else pending)",
  bucketDisagreements.slice(0, 5).join('\n       '),
);

if (mismatches.length === 0) {
  check(true, `portal resolveOrderFulfillmentStatus === projection(PS.resolveOrderLifecycleStatus) on all ${cells} cells`);
} else {
  // Group by cause so a reader sees the shape of the disagreement, not 100 lines of cells.
  const groups = new Map<string, Mismatch[]>();
  for (const m of mismatches) {
    const key = `PS ${m.psStatus} -> expected '${m.expected}', portal '${m.portal}'`;
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  const detail = [...groups.entries()]
    .map(([key, list]) => `${key} (${list.length} cells) e.g. ${list[0]!.input}`)
    .join('\n       ');
  check(false, `portal resolveOrderFulfillmentStatus differs from projection(PS.resolveOrderLifecycleStatus) on ${mismatches.length} of ${cells} cells`, detail);
}

console.log(
  `\nObserved PS lifecycle statuses: ${[...seenPsStatuses].sort().join(', ')}`,
);
console.log(
  `\n${
    failures === 0
      ? `PASS CP-069 order-lifecycle parity — CP ${cpSha} agrees with PS ${psSha}`
      : `FAIL CP-069 order-lifecycle parity — ${failures} failure(s)`
  }`,
);
if (failures > 0) process.exit(1);
