// Async billing-generate jobs.
//
// PrepShip's /billing/generate takes ~25s for a 90-day range. The portal proxies it and has a
// 15s whole-request budget, so the POST was killed at 15s and the UI reported
// "Billing update failed — the server took too long" for an operation that had SUCCEEDED
// upstream (observed 2026-08-30: portal 503 at 15s, upstream 200 at 24.6s). Users then retried,
// re-running a real billing regeneration that had already completed.
//
// So the POST now starts the work and returns a job id, and the client polls.
//
// STATE IS IN-MEMORY, DELIBERATELY. The upstream call is what performs the work, and it runs to
// completion whether or not anything is still listening — that is exactly what the incident
// showed. A job record therefore only REPORTS an outcome; losing it costs information, not
// correctness, and a poll for an unknown id says so plainly rather than implying the billing run
// failed. Persisting it would mean a migration and a second source of truth about billing runs,
// which is a worse trade for a reporting aid.
//
// Consequences, stated rather than discovered later:
//   - a deploy or restart mid-run loses the record; the run still finishes upstream
//   - with multiple instances a poll can land on an instance that never saw the job
// Both surface as `unknown`, which the route explains in those terms.
import { randomUUID } from 'node:crypto';

/** What a settled job returns to the poller: the response the POST used to send. */
export type BillingGenerateOutcome = {
  readonly httpStatus: number;
  readonly body: Record<string, unknown>;
};

type Job = {
  readonly ownerKey: string;
  readonly startedAt: number;
  settledAt: number | null;
  outcome: BillingGenerateOutcome | null;
};

/** Long enough to poll a slow run to completion and read the result, short enough not to leak. */
const JOB_TTL_MS = 15 * 60 * 1000;

const jobs = new Map<string, Job>();

function evictExpired(now: number): void {
  for (const [id, job] of jobs) {
    const reference = job.settledAt ?? job.startedAt;
    if (now - reference > JOB_TTL_MS) jobs.delete(id);
  }
}

/**
 * Jobs are readable only by the identity that created them.
 *
 * A billing run's result names how many lines were generated for a scope, so an unguessable id
 * is not on its own an authorisation story. The poll route re-derives this key from the caller's
 * own session and must match.
 */
export function billingJobOwnerKey(userId: string): string {
  return `user:${userId}`;
}

export function createBillingGenerateJob(ownerKey: string): string {
  const now = Date.now();
  evictExpired(now);
  const id = randomUUID();
  jobs.set(id, { ownerKey, startedAt: now, settledAt: null, outcome: null });
  return id;
}

export function settleBillingGenerateJob(id: string, outcome: BillingGenerateOutcome): void {
  const job = jobs.get(id);
  // A job evicted by TTL before its run finished is not an error: the work completed upstream
  // and nobody is waiting. Dropping the outcome is the correct end state.
  if (!job) return;
  job.settledAt = Date.now();
  job.outcome = outcome;
}

export type BillingGenerateJobView =
  | { readonly state: 'unknown' }
  | { readonly state: 'running'; readonly elapsedMs: number }
  | { readonly state: 'settled'; readonly outcome: BillingGenerateOutcome };

export function readBillingGenerateJob(id: string, ownerKey: string): BillingGenerateJobView {
  evictExpired(Date.now());
  const job = jobs.get(id);
  // Same answer for "no such job" and "not yours", so polling cannot enumerate other people's
  // billing runs.
  if (!job || job.ownerKey !== ownerKey) return { state: 'unknown' };
  if (job.outcome) return { state: 'settled', outcome: job.outcome };
  return { state: 'running', elapsedMs: Date.now() - job.startedAt };
}

/** Test seam: the registry is process-global, so suites must be able to start clean. */
export function resetBillingGenerateJobsForTest(): void {
  jobs.clear();
}
