# Client-portal integration suite

The **behavioral** test layer. The ~90 `test:*` / `guard:*` scripts pin the
code's *shape* (source-pins); this suite seeds a real Postgres and runs the
**actual read-model functions**, asserting real numbers. It exists because every
bug that reached production this cycle passed the static guards green:

| Bug (shipped past static guards) | Assertion here that catches it |
| --- | --- |
| Dashboard vs Analysis revenue drift (CP-010) | Group 1: canonical totals == per-SKU roll-up, cancelled + other-client excluded |
| Analysis drawer 404 for scoped users | Group 2: scoped `inv_sku_id` resolves to the caller's own inventory row, not the global one |
| Carrier leaking to financials-enabled clients (CP-009) | Group 3: client DTO exposes no carrier/service (address stays), operator path unchanged |
| Billing footer ≠ invoice detail (CP-011) | Group 4: billing period-summary total == Σ invoice-detail row totals |

## Safety

This suite **seeds and truncates** tables, so it only ever runs against a
throwaway database. `guard.ts` refuses to run unless `TEST_DATABASE_URL` is set,
and hard-refuses anything that points at the production project or equals the
app's `DATABASE_URL`. It never connects until those checks pass.

## Run it locally

```bash
# 1. A throwaway Postgres (nothing here touches prod):
docker run -d --name pptest -e POSTGRES_PASSWORD=pw -p 5433:5432 postgres:16
export TEST_DATABASE_URL="postgres://postgres:pw@localhost:5433/postgres"

# 2. Apply the schema (drizzle-kit push, guarded):
npm run test:client-portal-integration:setup

# 3. Run the suite:
npm run test:client-portal-integration
```

## CI

`.github/workflows/integration-tests.yml` runs the whole thing against a
`postgres:16` service container on every PR to `main` — this is where the
behavioral tests gate merges.

## Adding assertions

Add fixtures in `seed()` and a group in `main()`. Keep fixtures **typed**
(`db.insert(schema.X).values(...)`) so `npm run typecheck` validates them against
the real schema. Import and call the real read-model/DTO functions — never
re-implement their logic in the test.
