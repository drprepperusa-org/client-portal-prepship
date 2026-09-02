# CP-068 — Portal invoice Export serves PrepShip's workbook (design)

Date: 2026-09-02 · Ticket: CP-068 (proposed) · Origin: PS-520 r6 pre-audit finding

## Context that shaped this design

- The portal's Billing "Export" built its OWN `.xlsx` in the browser
  (`portal-client/src/lib/invoiceExcel.ts`): 15→19 columns of its own choosing,
  a totals row summed client-side over `/invoice-details` rows. That is a
  second serializer of invoice money — the exact class of drift CP-066 removed
  from the HTML invoice, which now renders PrepShip's canonical totals.
- PrepShip owns ONE workbook: `GET /billing/invoice.xlsx` in
  `src/routes/billing.ts`, columns from `billing-invoice-columns.ts` (19,
  append-only), totals row as `SUM()` formulas, money via `billingInvoiceData`
  (PS-491 duplicate suppression + cancelled-no-charge applied).
- DJ's rule: "it must always the same data whatever export/invoice, excel or
  CSV" — cross-app. A workbook the portal assembles itself cannot satisfy that
  by construction; only PrepShip's bytes can.
- CLAUDE.md (shadow-renderer law) / PS-316: backend-owned money; the portal is
  display / pass-through only.

## Decisions

- **The portal never builds spreadsheet cells.** `invoiceExcel.ts` and the
  `write-excel-file` dependency are removed. A guard fails if any portal code
  (frontend or API) constructs invoice spreadsheet cells or imports a
  spreadsheet writer.
- **Export = PrepShip's bytes, verbatim.** New route
  `GET /api/client-portal/invoice.xlsx` (and `/invoice.csv`, same proxy)
  forwards the caller's bearer to `PREPSHIP_API_URL/billing/invoice.{xlsx,csv}`
  and streams the response body back unmodified: same content-type, same
  `content-disposition` filename, `x-content-type-options: nosniff`,
  `cache-control: no-store`.
- **Only DAYS cross the boundary.** The route normalizes through
  `requireBillingDayRange` and sends `range.fromDay` / `range.toDay`, never
  `toUtcExclusive` (PrepShip re-runs `billingDayRange` on what it receives and
  reads the date part as the LAST INCLUDED day — the 9/1-in-August bug).
- **Scope is enforced twice, never widened.** The route requires a portal
  scope, `financials:read`, a `clientId` visible under `clientFilterPredicate`
  (404 otherwise), and a bearer (401 otherwise). PrepShip re-authorizes the
  same bearer against its own client scope. Denials never reach upstream.
- **Fail closed on every uncertainty.** Missing `PREPSHIP_API_URL` → 503;
  transport error / upstream 5xx / unexpected content-type / an `.xlsx` body
  that is not a ZIP (`PK\x03\x04`) / an empty body → 502 with a generic
  message; upstream 401/403 → same status, generic "Not found" detail (no
  client-id enumeration). No partial file is ever served.
- **Multi-client "Export all" is DEFERRED to DJ.** The old path merged every
  client into one sheet with a Client column. PrepShip's workbook is
  per-client. Until DJ chooses (one workbook per client, or a merged form
  built by PrepShip), the button exports when the page resolves to ONE client
  and otherwise asks the user to pick a client. No merged form is built here.
- **CSV rides the same proxy.** `/invoice.csv` exists for API parity (same
  dataset, same rules); the UI adds no CSV button in this card.
- **Carrier column — flagged, not decided here.** PrepShip's workbook carries
  `Carrier` (column 18). CP-018/CP-024 keep carrier identity out of every
  customer surface, and the SOT matrix records no DJ-approved exception.
  Serving the bytes verbatim to a client-scoped user would ship that column.
  This branch is therefore NOT merged to `main` until DJ rules: approve the
  exception (recorded in the matrix), or have PrepShip blank the cell for
  non-global scope (a PrepShip change), or hold.

## Components

- `src/lib/client-portal/prepship-invoice-export-proxy.ts` (NEW, small) —
  `fetchCanonicalInvoiceExport(authorization, { clientId, dateFrom, dateTo,
  format }, requestId)` → `{ ok: true, bytes, contentType, filename }` or
  `{ ok: false, status, code, error }`. Same shape/idiom as the details and
  totals proxies. No parsing of cells; only transport + shape checks.
- `src/routes/client-portal/invoice-export.ts` (NEW sub-router, mounted by
  `src/routes/client-portal.ts` like every file in that folder) — `/invoice.xlsx`
  and `/invoice.csv` sharing one handler; audit events
  `portal.invoice_export.{denied,failed,view}`.
- `src/middleware/request-timeout.ts` — the two export paths join the invoice
  exemption (they are invoice rendering across a range; PrepShip owns the
  60s ceiling inside the proxy).
- `src/main.ts` — `Content-Disposition` added to CORS `exposeHeaders` so the
  browser can read PrepShip's filename.
- `portal-client/src/lib/api/transport.ts` — `apiBlob()` (binary GET,
  returns bytes + content-type + filename).
- `portal-client/src/lib/downloadFile.ts` (NEW, small) — object-URL download
  of a Blob; no cell decisions.
- `portal-client/src/lib/api/domains/billing.ts` — `invoiceWorkbookRange()`.
- `portal-client/src/components/billing/invoices/useInvoiceActions.ts` —
  `exportExcel` / `exportAllPeriods` download PrepShip's file; no row fetch,
  no local sheet.
- Removed: `portal-client/src/lib/invoiceExcel.ts`, `fetchAllInvoiceRows`
  (+ its page constants) in `invoiceRows.ts`, `write-excel-file` dependency.

## Tests / guards

- `scripts/client-portal-invoice-export-proxy-guard.ts` (static + executable,
  in `test:guards`): no spreadsheet writer anywhere in portal code; no
  cell-shaped literals; route sends days only; scope + bearer checks precede
  the upstream call; proxy (with a stubbed fetch) forwards the bearer
  verbatim, sends `dateFrom`/`dateTo` days, rejects non-ZIP `.xlsx` bodies,
  wrong content-types, empty bodies, 5xx, maps 401/403 without detail, 503
  without configuration.
- `scripts/integration/client-portal-invoice-export-cp068.integration.ts`
  (throwaway Postgres, stubbed upstream): drives the real Hono router; the
  proxied bytes are byte-identical to the fixture, are a valid workbook
  (`jszip` opens it), and row 1 of the `Invoice` sheet is PrepShip's
  19-column header; scope/bearer/financials/404/502 paths; CSV path.
- `fixtures/cp-068-prepship-invoice-workbook.xlsx` + `.json` sidecar
  (producer SHA, sha256, header list) generated by PrepShip's REAL
  `renderInvoiceXlsx` via `scripts/fixtures/generate-cp068-invoice-workbook.mts`
  against a sibling `prepship-v4` checkout.
- Retired guard assertions that pinned the local sheet: column-order,
  export-range (rewritten), returns-display §5b, producer-contract XLSX
  section, ps-434 excel line, ps-384 fetch-all checks, cp-059 mutation
  harness XLSX mutations.

## Out of scope

- The merged multi-client export (DJ decision).
- PrepShip-side carrier redaction (DJ decision; PrepShip change).
- A CSV button in the UI.

## r2 — after Hermes r1 (71%)

Hermes wrote a disposable alternate exporter (cells joined into a CSV string in a
Blob) and the r1 pattern guard stayed green. r2 proves the property instead of the
absence:

- `portal-client/src/lib/invoiceWorkbookDownload.ts` (NEW, pure) — the Blob the
  API returned is the Blob the sink receives, same object. The hook wires
  `portalApi.invoiceWorkbookRange` and `downloadFile` into it and nothing else.
- `scripts/client-portal-invoice-export-no-local-builder-guard.ts` (NEW, 7 checks)
  — EXECUTES the module and `downloadFile` with a sentinel Blob and asserts identity
  end to end; statically pins the hook wiring (one `new Blob`, the HTML window; no
  `File`, no joins, no data URI), forbids any CSV/TSV/Excel/octet-stream media
  type or data URI in `portal-client/src` (the workbook type only as the Accept
  header), and forbids row joining anywhere on the export path.
- `scripts/cp-068-mutation-harness.ts` (NEW, `test:cp-068-mutations`, in
  `test:guards`) — ten mutations, the first being Hermes's exporter verbatim; each
  must turn its guard red; sources restored and verified after every run.
- `web/e2e/client-portal-cp068-export.spec.js` (NEW, `test:cp-068-export:browser`,
  in ci.yml) — a real Chromium clicks Export: the request carries one client, plain
  days and the caller's bearer; the saved file is sha256-identical to the fixture
  under PrepShip's filename; "Export all" across several clients requests nothing.
- Fixture determinism — the generator pins `docProps/core.xml` timestamps and ZIP
  entry dates to one instant and re-emits the container with fixed settings, so a
  clean regeneration reproduces the committed sha256 (`--check` proves it). Business
  members are the renderer's, untouched; their sha256s are in the sidecar.
