/**
 * CP-059A — the Client Portal is not a billing writer.
 *
 * PrepShip (and the database) is the sole owner of `billing_line_items` generation.
 * The portal keeps its live operator workflow as an authenticated, scoped PROXY to
 * PrepShip, and retains every billing READ. It generates nothing.
 *
 * WHY A GUARD AND NOT JUST A DELETION
 *
 * Deleting `generateLineItems` proves nothing about tomorrow. A contributor who has
 * never read PS-488 can reintroduce a local writer in an afternoon, and the failure is
 * silent: rows appear in one money table from two authorities, with the portal's rows
 * carrying canonical return line types and no relational `return_id`. That is exactly
 * the defect PS-488 spent four review rounds correcting.
 *
 * COMMENT-AWARE ON PURPOSE
 *
 * Every source-text assertion here runs against a comment-stripped view. During PS-488
 * a delegation assertion passed against code that had the import COMMENTED OUT — the
 * regex matched the comment. Prose describing a retired writer must never satisfy a
 * check that the writer is gone.
 *
 * Offline/pure: no DB, no network, no provider calls.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let failures = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`FAIL ${name}: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Comments removed, so prose can never satisfy a "this does not exist" assertion.
 *
 * ORDER MATTERS, and the obvious order is wrong. Stripping block comments first ate
 * 10,715 characters of this repository's proxy route: a LINE comment there mentions a
 * route path containing `/*`, and the block-comment pattern latched onto that and ran to
 * the next `*​/` far below. The file arrived at the assertions with most of its code
 * missing, so "the proxy route must remain" failed against a file that still had it.
 *
 * Line comments are therefore removed FIRST, which consumes any `/*` living inside one.
 * The `[^:]` guard keeps `https://` from being read as a comment.
 */
function stripComments(source: string): string {
  return source
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Every active server source file. Excludes tests, fixtures and the guard scripts. */
function activeServerSources(dir = 'src', acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (/node_modules|__tests__|__fixtures__/.test(entry)) continue;
      activeServerSources(full, acc);
    } else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

const SERVER_SOURCES = activeServerSources();

// ── 1. the retired writer is gone, structurally ──────────────────────────────
check('src/services/billing.ts does not exist', () => {
  // Not emptied, not stubbed — deleted. A file by that name is an invitation to add a
  // generator back to the portal, and its absence is what makes reactivation require
  // deliberately re-authoring one.
  assert.equal(
    existsSync('src/services/billing.ts'),
    false,
    'the file that owned generateLineItems must not exist',
  );
});

check('generateLineItems is not defined anywhere in active server code', () => {
  for (const file of SERVER_SOURCES) {
    const code = stripComments(readFileSync(file, 'utf8'));
    assert.ok(
      !/(export\s+)?(async\s+)?function\s+generateLineItems\b/.test(code),
      `${file} defines generateLineItems`,
    );
  }
});

check('no active server file imports or calls generateLineItems', () => {
  for (const file of SERVER_SOURCES) {
    const code = stripComments(readFileSync(file, 'utf8'));
    assert.ok(!/\bgenerateLineItems\b/.test(code), `${file} references generateLineItems`);
  }
});

// ── 2. no billing_line_items write remains reachable ─────────────────────────
/**
 * The ONE authorised billing_line_items write left in the portal.
 *
 * POST /admin/purge-test-orders removes rows belonging to `isTest` clients. It is
 * test-data cleanup, not billing generation, and Hermes ruled it explicitly preserved.
 *
 * It is CLASSIFIED here rather than skipped. A silent exclusion would let the purge
 * quietly grow into a generator; the assertions below hold it to being a delete-only
 * operation confined to this one route.
 */
const PURGE_ROUTE = 'src/routes/admin.ts';

check('no active server file writes billing_line_items via the ORM', () => {
  // The generator's signature move was delete-then-recreate for a period. Any
  // insert/update/delete against this table from portal code is a second authority.
  for (const file of SERVER_SOURCES) {
    if (file.replace(/\\/g, '/') === PURGE_ROUTE) continue; // classified below
    const code = stripComments(readFileSync(file, 'utf8'));
    const hit = /(?:db|tx|trx)\s*\.\s*(delete|insert|update)\s*\(\s*billingLineItems\s*\)/.exec(code);
    assert.equal(
      hit?.[1] ?? null,
      null,
      `${file} performs a billing_line_items ${hit?.[1] ?? 'write'} — PrepShip is the sole writer`,
    );
  }
});

check('the admin test-data purge stays a DELETE-only test-data operation', () => {
  const code = stripComments(readFileSync(PURGE_ROUTE, 'utf8'));

  // It may delete. It may never create or amend a billing row — that would make it a
  // generator wearing a purge's name.
  assert.ok(
    !/(?:db|tx|trx)\s*\.\s*(?:insert|update)\s*\(\s*billingLineItems\s*\)/.test(code),
    'the purge must never insert or update billing_line_items',
  );
  assert.ok(
    !/insert\s+into\s+(public\.)?billing_line_items/i.test(code),
    'the purge must never insert billing_line_items via raw SQL',
  );

  // The delete must remain confined to test clients, so it can never reach real billing.
  assert.ok(/isTest/.test(code), 'the purge must select its scope from isTest clients');
  assert.ok(/purge-test-orders/.test(code), 'the purge route must keep its explicit name');

  // And it must not acquire a generator.
  assert.ok(!/\bgenerateLineItems\b/.test(code), 'the purge must not call a generator');
});

check('the purge route is the ONLY classified billing writer', () => {
  // If a second file ever needs an exception, this fails and forces the decision to be
  // made deliberately rather than by adding another quiet skip above.
  const writers = SERVER_SOURCES.filter((file) => {
    const code = stripComments(readFileSync(file, 'utf8'));
    return /(?:db|tx|trx)\s*\.\s*(?:delete|insert|update)\s*\(\s*billingLineItems\s*\)/.test(code);
  }).map((f) => f.replace(/\\/g, '/'));
  assert.deepEqual(writers, [PURGE_ROUTE],
    `exactly one classified billing writer is permitted; found: ${writers.join(', ') || 'none'}`);
});

check('no active server file writes billing_line_items via raw SQL', () => {
  // The ORM check above is bypassable with a raw statement, so both are asserted.
  for (const file of SERVER_SOURCES) {
    const code = stripComments(readFileSync(file, 'utf8'));
    assert.ok(
      !/(insert\s+into|update|delete\s+from)\s+(public\.)?billing_line_items/i.test(code),
      `${file} contains raw SQL writing billing_line_items`,
    );
  }
});

// ── 3. no worker, cron or fallback can reactivate generation ─────────────────
check('the parked auto-generation helper stays a no-op', () => {
  const helper = stripComments(readFileSync('src/services/billing-auto-generate.ts', 'utf8'));
  assert.ok(!/\bgenerateLineItems\b/.test(helper), 'the parked helper must not call a generator');
  assert.ok(
    !/(?:db|tx)\s*\.\s*(?:delete|insert|update)\s*\(\s*billingLineItems\s*\)/.test(helper),
    'the parked helper must not write billing rows',
  );
});

check('no worker or cron entry point reaches a local billing generator', () => {
  for (const file of SERVER_SOURCES.filter((f) => /worker|cron|scheduler|job/i.test(f))) {
    const code = stripComments(readFileSync(file, 'utf8'));
    assert.ok(!/\bgenerateLineItems\b/.test(code), `${file} reaches a local generator`);
    assert.ok(
      !/(?:db|tx)\s*\.\s*(?:delete|insert|update)\s*\(\s*billingLineItems\s*\)/.test(code),
      `${file} writes billing_line_items`,
    );
  }
});

check('the legacy billing route mounts no local generate endpoint', () => {
  // Production already withholds this route via clientPortalOnly, but a
  // non-production configuration mounts it. Retirement must hold in BOTH.
  const route = stripComments(readFileSync('src/routes/billing.ts', 'utf8'));
  assert.ok(
    !/app\.post\(\s*['"]\/generate['"]/.test(route),
    'src/routes/billing.ts must not define a local POST /generate',
  );
});

// ── 4. the LIVE operator workflow is preserved ───────────────────────────────
check('the client-portal proxy route still exists and forwards to PrepShip', () => {
  const proxy = stripComments(readFileSync('src/routes/client-portal/billing.ts', 'utf8'));
  assert.ok(/app\.post\(\s*['"]\/billing\/generate['"]/.test(proxy),
    'the proxy route must remain');
  assert.ok(/PREPSHIP_API_URL/.test(proxy),
    'the proxy must resolve the canonical PrepShip base URL');
  assert.ok(/fetch\(\s*`\$\{baseUrl\}\/billing\/generate`/.test(proxy),
    'the proxy must forward to PrepShip /billing/generate');
  assert.ok(!/\bgenerateLineItems\b/.test(proxy),
    'the proxy must not fall back to a local generator');
});

check('the proxy keeps auth, tenant-override rejection and bearer forwarding', () => {
  const proxy = stripComments(readFileSync('src/routes/client-portal/billing.ts', 'utf8'));

  // Anchored INSIDE the outgoing fetch. A file-wide /authorization/i match was satisfied
  // by the `const authorization = c.req.header(...)` DECLARATION, so deleting the header
  // from the upstream request left the guard green while the proxy forwarded no
  // credential at all — the upstream call would have been unauthenticated.
  const fetchBlock = /await fetch\(\s*`\$\{baseUrl\}\/billing\/generate`[\s\S]*?\n  \}\);/.exec(proxy)?.[0] ?? '';
  assert.ok(fetchBlock.length > 0, 'the upstream fetch call must be locatable');
  assert.ok(/headers:\s*\{[\s\S]*?\bauthorization\b/.test(fetchBlock),
    'the caller bearer token must be forwarded in the upstream request headers');

  assert.ok(/const authorization = c\.req\.header\(/.test(proxy),
    'the proxy must read the caller bearer token');
  assert.ok(/Missing bearer token/.test(proxy),
    'a missing bearer token must be rejected, not forwarded as anonymous');
  assert.ok(/recordPortalAudit\(/.test(proxy), 'audit events must be recorded');
  assert.ok(/denied/.test(proxy), 'a denied path must exist for unauthorised callers');
});

check('the portal UI still calls the proxy, not a local endpoint', () => {
  const ui = readdirSync('portal-client/src/lib/api/domains', { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => readFileSync(join('portal-client/src/lib/api/domains', e.name), 'utf8'))
    .join('\n');
  const code = stripComments(ui);
  assert.ok(/client-portal\/billing\/generate/.test(code),
    'the UI must call the client-portal proxy path');
});

// ── 5. billing READS are untouched ───────────────────────────────────────────
check('billing read models and their scope helpers survive', () => {
  assert.ok(existsSync('src/services/billing-read-support.ts'),
    'the extracted read-support helpers must exist');
  assert.ok(existsSync('src/services/billing-summaries.ts'),
    'billing summaries must still exist');
  const support = stripComments(readFileSync('src/services/billing-read-support.ts', 'utf8'));
  for (const helper of [
    'billingClientScopePredicate',
    'billingLineItemScopePredicate',
    'itemSummary',
    'dimsKey',
    'dimsLabel',
    'toNum',
    'stringOrNull',
    'providerAccountIdOrNull',
    'toFiniteNumber',
  ]) {
    assert.ok(new RegExp(`export function ${helper}\\b`).test(support),
      `${helper} must remain available to the read models`);
  }
  // The support module must never become a writer itself.
  assert.ok(
    !/(?:db|tx)\s*\.\s*(?:delete|insert|update)\s*\(/.test(support),
    'billing-read-support.ts must contain no write of any kind',
  );
});

if (failures > 0) {
  console.error(`\nFAIL CP-059A writer retirement guard (${failures} failing)`);
  process.exit(1);
}
console.log('\nPASS CP-059A writer retirement guard');
