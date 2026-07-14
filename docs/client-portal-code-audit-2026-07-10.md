# Client Portal Code Audit — refreshed 2026-07-14

## Outcome

Six audited hotspots were split without changing Client Portal behavior:
Invoices, DataTable, StoreConnectModal, access routes, integration routes, and
returns routes. The active `portal-client/` remains a backend-shadow renderer;
HTTP routes, DTOs, billing formulas, permissions, audit ordering, credential
redaction, return-label ownership, and canonical data owners are unchanged.

The former 904-line returns exception is removed. Every extracted hotspot file
is at most 281 lines and every extracted function/component is at most 135
lines. Dashboard, Shipments, and Analysis were not changed.

`npm run test:full-site-certification` passes, including typecheck, production
build, bundle limits, architecture/SOT guards, signed-out smoke tests, and the
12-test Client Portal UI suite at mobile, tablet, and desktop widths.

## Measurements

Physical line counts include comments and blank lines. Function/component sizes
come from the TypeScript AST.

| Surface | Before | After | Boundary |
|---|---:|---:|---|
| Maintained CP TypeScript | 161 files | 175 files / 19,693 lines | Generated logos excluded |
| Active frontend | 125 files / 17,274 lines | 148 files / 16,316 lines | Vite `portal-client/` only |
| `Invoices.tsx` | 396 lines | 144-line orchestrator | 5 modules, max 131 lines |
| `DataTable.tsx` | 436 lines | 103-line public facade | 4 internal modules, max 281 lines |
| `StoreConnectModal.tsx` | 484 lines | 194-line stage owner | 5 stage/field modules, max 135 lines |
| Access routes | 500 lines | 15-line ordered aggregator | 4 modules, max 164 lines |
| Integration routes | 456 lines | 14-line ordered aggregator | 5 modules, max 216 lines |
| Returns routes | 904 lines | 14-line ordered aggregator | 5 modules, max 250 lines |

The returns runtime route table still contains exactly nine endpoints in the
original order: list, locations, detail, create, label, deliver, receiving,
inspection, and inspection media.

## Module ownership

- Invoices owns query/state orchestration; period rows, line items,
  presentation mapping, and export/view actions live in focused modules.
- DataTable keeps the public `DataTable` and `Column` exports; desktop, mobile,
  types, and resize/reorder logic are internal modules.
- StoreConnectModal retains stage transitions and submission ownership; list,
  credentials, review, fields, and local types are extracted.
- Access registers read, invitation/activation, user mutation, and settings
  routes in the original order. Shared helpers retain fail-closed critical audit
  behavior before mutation.
- Integrations registers read/validate, submission, then approval/reconnect/
  disconnect. Shopify verification and credential parsing remain backend-only.
- Returns registers read routes, client actions, then receiving routes. Scope,
  DTO redaction, billing-owned customer postage, label idempotency, inspection,
  and private-media behavior retain their canonical owners.

## Guard changes

String-based feature guards now use the fail-closed `readSourceTree` helper for
split modules. Discovery is deterministic, only expected TypeScript sources are
accepted, and missing paths fail. Function-size validation remains active for
any frozen file exception; the returns exception itself is gone.

The focused gates cover billing totals/export, DataTable sorting/layout/RBAC,
store-connect credential redaction, access audit-before-mutation, CP-054,
credential accounts, every CP returns guard, API contracts, architecture, and
the shadow-renderer law. DB-backed access, Shopify, CP-043, and CP-057 suites
still require `TEST_DATABASE_URL` pointing to a throwaway Postgres and refuse to
run without it; this workstation has no Docker/Postgres runtime.

## Enforced limits

`npm run audit:client-portal-maintainability` scans active Client Portal
TypeScript using physical LOC and TypeScript AST function sizes:

- Default file limit: 500 lines.
- Default function/component limit: 350 lines.
- Hotspot refactor target: 300 lines per touched file and 200 lines per touched
  function/component; all extracted hotspot modules pass.
- Frozen returns exception: removed.

`npm run test:web-bundle-budget` currently reports:

| Asset budget | Limit | 2026-07-14 result |
|---|---:|---:|
| CSS raw | 75 KiB | 52,672 bytes |
| CSS gzip | 15 KiB | 10,139 bytes |
| Largest JS raw | 735 KiB | 720,519 bytes |
| Largest JS gzip | 215 KiB | 209,151 bytes |
| Total JS raw | 1.9 MiB | 1,776,417 bytes |
| Total JS gzip | 535 KiB | 505,061 bytes |

## Remaining large unchanged surfaces

- `Analysis.tsx`: 389 lines.
- `Shipments.tsx`: 362 lines.
- `Dashboard.tsx`: 358 lines.
- The chart vendor chunk remains inside its approved cap but is still the
  largest production chunk.
