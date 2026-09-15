# Portal Orders count performance — 2026-09-15

## Placement and measurement

User outcome: shorten Orders loading and remove repeated awaiting-count work while
preserving search, sort, pagination, filters and accurate counts.

The preceding read-only production sample showed Orders list median 651 ms (15
requests) and awaiting-count median 462 ms (20 requests). These are observed API
response times, not browser load times or a controlled production comparison.

Canonical owner: `src/lib/client-portal/read-models/orders.ts`. Rows and counts come
from the same scoped `orders` selectors, PrepShip lifecycle bucket, active-client
and portal placeholder policies. Search additionally uses canonical `order_items`
and the client name. Event clock is the current committed database state.
`pagination.total` and the badge's `count` remain server-owned. Rates, fulfillment
signals, DTO shaping and financial/weight redaction keep their existing owners.

Delay entry: the list waited for the row query before starting its count, while
the sidebar independently counted the same awaiting rows. The native PostgreSQL
test reproduced two count statements for one concurrent list/badge pair.

## Change

The list now starts its count independently of page loading. Item enrichment still
waits for that page's order IDs. List, badge and Dashboard's awaiting-count caller
delegate to one count executor in the existing read model.

Only **pending** reads may be reused. The key contains signed-in user ID plus the
actual SQL and bound parameters, so explicit client/store filters, allowed scope,
search and lifecycle status cannot share a different count. The key is private,
never logged, and is deleted on success or failure. There is no TTL or retained
count cache. A later request rereads committed data, including after mutations.
Sharing is limited to overlapping calls in one API process.

The count's client join matches the list's existing count query. The badge's
additional left join cannot multiply orders because `clients.id` is a primary key.
No predicates, schema, index, permissions, frontend code or polling intervals change.
No production record writes, provider calls or operational workflow actions are
needed for verification or rollout.

## Verification plan

- Execute the real owner and SQL on disposable PostgreSQL: count statements,
  bounds on active reads, same-user shared reads, distinct scopes/search/filters,
  later committed changes, failed count eviction and retry, pagination and status.
- Existing Orders lifecycle/fulfillment and main portal database integration suites
  verify canonical item, status, shipping, active-client and placeholder behavior.
- Full guards cover architecture, shadow-renderer, scope/redaction, query/session
  contracts and UI. Run focused Orders browser proofs after mutation tests finish.
- Typecheck and production build. Deploy the committed candidate and verify exact
  commit readiness and the unauthenticated production boundary.

Initial local round-trip scenario (40 ms added at each measured DB read):
221 ms / two counts before; 170 ms / one count after. Peak active reads stayed two.
Candidate native PostgreSQL runs with no added delay: 20 paired reads, 20 count
statements, median 9 ms, p95 19 ms. These fixture results establish the saved query
and scheduling change; they do not establish a production speed percentage.
The baseline owner from commit `165ba5b` executed 40 count statements over 20 native
pairs (median 11 ms, p95 13 ms). The small native samples have mixed latency results;
the deterministic improvement is halving the duplicated count work. The added-delay
scenario models database round trips, not a production throughput benchmark.

Rollback base: `165ba5bfc0b553eaac8b2eadd5ebc43076e13869`. No migration or deployment
configuration changes are needed.

## Completed local verification

- Real PostgreSQL Orders performance integration passed, including failure eviction,
  later committed changes, scope isolation, filters and pagination. Final delayed
  sample: 175 ms, one count, peak two reads. Native repeat: 20 counts over 20 pairs,
  median 11 ms, p95 21 ms; this does not demonstrate a production latency reduction.
- Existing main portal, access/security, CP-069 Orders fulfillment and CP-061
  replacement integration suites passed. CP-061 also verified Orders after the
  replacement tables were dropped in the disposable test database.
- Full guard run: 185/186 passed initially. The remaining contract-drift command
  failed on a fixture TypeScript narrowing error; after adding the fixture assertion,
  its complete command and backend/frontend typechecks passed on rerun.
- Full-site certification (including production build and portal UI/auth smoke)
  passed inside the guard suite. After all mutation tests finished, six focused
  Orders browser tests passed: four status/return-eligibility scenarios and two
  sorting/pagination/loading-retention scenarios.
- `git diff --check` passed. No production business records were used or changed.
