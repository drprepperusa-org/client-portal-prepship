# Shared-database optimization — final local follow-up, September 8, 2026

> Subsequent verification: [Billing visibility repair and repeated measurements](shared-database-rendering-followup-2026-09-09.md) addresses the first-visible tradeoff retained below. This report preserves its original results.

The full native page grid is complete and the reproduced Billing companion slowdown has a local repair. Installed Portal driver identity is now verified. **This is a reviewable local candidate; it is not deployment, merge, production acceptance, or proof of uniformly faster first paint.**

## What changed in this follow-up

CPU sampling found most Billing row-processing time in the callback constructing each wide DTO. The existing code first created a redacted rest object, then spread it into another object while adding fields. The repair uses Object.assign to extend that newly created private object. It never mutates the database row or changes the money, grouping, status, redaction, selection, or identity owners. Field overwrite order stays the same, including billingStatus and order-description attribution.

In two diagnostic runs of 20 canonical reads, callback self time fell 4694.51 → 274.50 ms (94.15% less). GC self time fell 1594.89 → 361.69 ms. These sampling profiles identify the hotspot and corroborate reduced allocation; they are not page latency percentiles.

The protected source touched in this follow-up is src/services/billing.ts, under the user's existing exact unlock shipped data authorization. It changes read-only DTO allocation. No shipped/cancelled write guard, charge decision, stored quantity, shipment history, or permission changes.

## Page results and scope

The preceding [full native page report](shared-database-pages-2026-09-08.md) retains 1,224 warm page loads and 60 cold application samples for Orders, Inventory and Billing. Large Inventory completion median improved about 41% there. All requests succeeded, audits persisted, and no work remained outstanding at settlement. The original over-threshold samples remain preserved.

A first Billing recheck reproduced the large one-user companion p95 increase: 56.26 → 77.17 ms (+37.17%). Connection acquisition stayed near 0.01 ms; PrepShip event-loop blocking reached roughly 350 ms. That motivated the allocation repair.

Post-repair recheck: 308 additional warm page loads, alternating version order. One-user scenarios have 50 paired rounds; four-user scenarios have 13 paired bursts (52 loads per version). All functional assertions passed. Times below are median / p95 milliseconds.

| Billing dataset / users | First visible | Complete | Unchanged companion p95 |
|---|---|---|---|
| small / 4 | 298.50 / 497.50 → 311.10 / 653.60 | 1087.40 / 1336.70 → 1081.00 / 1360.80 | 22.42 → 23.11 (3.07%) |
| large / 1 | 160.60 / 197.20 → 161.60 / 197.80 | 1186.70 / 1231.70 → 852.50 / 982.80 | 38.84 → 25.84 (-33.48%) |
| large / 4 | 352.10 / 798.90 → 375.20 / 853.10 | 1915.40 / 2284.50 → 1687.60 / 1917.00 | 163.79 → 93.60 (-42.85%) |

Important baseline boundary: both Portal consumer versions use the current additive canonical-ID PrepShip producer in this lane. The post-fix run therefore uses the faster producer on BOTH sides. It tests the Portal changes under the repaired shared system; comparing its absolute values to an earlier run is not a paired estimate of the allocation fix. The CPU profiles and exact native pre-change-owner DTO parity provide separate evidence for that repair. Companion observation windows cover the page workload, so shorter page loads contain fewer companion samples; all samples and timing offsets are retained, not padded with idle requests.

Post-fix companion cases above 10%: none in the targeted recheck. This supports resolution of the reproduced Billing contention finding, without erasing the old failures or promising carrier/network speed.

First-visible tradeoff retained: small/4: first-visible p95 +31.38%. Small four-user Billing first-visible tail was also slower in prior runs. Complete-result time there is essentially flat. This candidate reduces request/payload/large-range completion cost; it does not make every first-visible measurement faster. Review this tradeoff explicitly before rollout; do not report it as a universal speedup.

| Dataset / users | PrepShip event-loop maximum p95 per warm burst, ms |
|---|---|
| small / 4 | 25.41 → 25.56 |
| large / 1 | 97.65 → 79.95 |
| large / 4 | 214.83 → 185.34 |

## Driver inspection and verification

Read-only Render Web Shell inspection of the existing Portal instance verified installed postgres **3.4.9**, database port **6543**, and prepare:false. The deployed source has no explicit max_pipeline setting. Existing deployment logs identify **Node 26.8.1 / Yarn 1.22.22**, with no existing Yarn lockfile. This supersedes the earlier unavailable-installation-evidence limitation. No app database client was imported and no production SQL was run.

The candidate's pinned driver/reservation fix/pipeline bundle additionally passed on an isolated official Node 26.8.1 Windows binary verified against Node's SHA-256 list: installation/version-drift checks, accepted-write backpressure, concurrent reads, transaction reservation, ESM/CJS native PostgreSQL transactions, savepoint/outer rollback, and connection reuse. Pool capacity and timeout policies were unchanged. This adds driver compatibility evidence; it is not clean-install Linux or whole-application Node 26 certification.

Native invoice/billing pagination tests passed after the allocation repair, including exact old-owner field parity, canonical event identities, every supported sort, whole-range totals and invalid/out-of-range pages. Orders DTO and margin/analytics parity also passed. Final PrepShip typecheck and the complete required SOT guard pack passed on clean local snapshot **749c2c79d833994cb26cccbd8f79da77bf8f5abd**. The final normalized source manifest matches the snapshot; prior source manifests and results remain historical evidence. Portal runtime sources are unchanged since their earlier passing typecheck, build, guards and browser checks.

## Review and release boundary

Review the measured first-visible tradeoff, final source diff and preserved business/security checks. Release sequencing remains separate phases, with the backward-compatible PrepShip billing producer before the Portal consumer; rollback reverses that dependency order. No push, deploy, merge, migration, index, provider probe, purchase, print, production data repair, hosting upgrade or connection-limit increase was performed.

Reproduce the targeted lane with the safe loopback runner, SHARED_DB_PARITY_ONLY=1, SHARED_DB_EXTENDED=1, SHARED_DB_PAGES=1 and SHARED_DB_PAGE_RECHECK=1. SHARED_DB_PROFILE=1 without PAGES creates the 20-read diagnostic profiles. Run native parity before accepting changed allocation, and run the required SOT pack from a clean tracked snapshot. Evidence JSON files reference hashed gzip archives for full raw page samples, profiles and final guard logs.
