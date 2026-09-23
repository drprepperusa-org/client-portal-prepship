# Return and inbound unsaved-form protection

## Placement contract
- Outcome: dirty Return and New Inbound drafts require Keep editing / Discard changes before dismissal or in-app navigation. Native browser leave/reload warning protects active drafts. Empty forms close normally; failed saves retain input; successful saves close without a second prompt.
- Owner: React owns only ephemeral draft intent. Existing portalApi.createReturn/createInbound and backend return/receiving services retain validation, scope, persistence, eligibility and label authority. No API, database or provider payload changes.
- Loss boundaries: modal close callbacks, router navigation, document unload, and Return's order-data effect resetting edits on refetch. Initialize return defaults once per open order/user session.
- Callers: Return creation on Orders, Shipments, Returns and order detail; New Inbound. Shared DraftModal handles confirmation and browser guards. Only open forms register blockers.
- Routing: use the supported createBrowserRouter root splat with existing App Routes/providers so useBlocker can protect back/forward and client navigation. No route or auth-policy changes.
- Focus: only the topmost dialog handles Escape/Tab; hidden draft controls must not enter the confirmation's focus loop. Preserve input DOM and restore focus after Keep editing.
- Saving: freeze form controls and block dismissal/navigation while a request is pending. Browser leave still warns. Existing return-create success plus label failure closes the creation draft to avoid accidental duplicate creation.
- Proof: mocked browser close/navigation/reload/save tests, shared-dialog regressions, existing return guards, typecheck, build, architecture/shadow-renderer and full-site certification. All external business APIs intercepted in browser tests.
- Live side effects: user authorized main push and deployment. No production records, labels, postage or marketplace notifications used for testing.

## Verification
- 13 focused browser cases passed: all close paths, focus trap/restore, discard/reopen, browser Back/Forward and in-app links, native reload warning, save failure retention, pending save lock, successful save cleanup, partial label failure, background order refetch and different-order isolation.
- Phone screenshots at 390px reviewed; Keep editing / Discard changes remain visible and fit inside the viewport.
- Typecheck and production build passed with the committed portal lockfile (React Router 7.18.3).
- Return CP-043/045/058/UI, architecture, shadow-renderer, tenant/store scope, RBAC, redaction, maintainability and source-line-length gates passed.
- Full-site certification passed: build/bundle, portal smoke, complete existing UI suite, shared modal/drawer accessibility and failure-state checks. Its environment-dependent pure guards used the same throwaway values as CI.
- Hosted CI now includes the focused browser suite. Exact-SHA CI and deployment receipts recorded separately after push.
- No backend, migration, provider or environment changes. No production business writes or real label operations. Rollback is a revert of this commit; drafts are memory-only.

## Hosted guard alignment
The first hosted run passed 187/188 guards. Mobile navigation's scroll-lock guard pinned the retired `previousOverflow` variable. Update it to require stack registration/removal and first-open/last-close preservation. The browser proof additionally checks that closing the return modal keeps scrolling locked while the order drawer remains open, and that closing the final drawer restores scrolling. Product code is unchanged in this follow-up.
