import { db } from '../db/client';
import { settings } from '../db/schema/settings';
import { generateLineItems } from './billing';

/**
 * Automatic billing generation (worker). Regenerates fulfillment charges for
 * a rolling recent window on an interval so the Billing page is up to date by
 * default — the portal's "Update billing" button remains the manual trigger
 * for an explicit range. generateLineItems is idempotent, so re-running over
 * the same window only fills gaps and refreshes changed shipments.
 */

const INTERVAL_MS = 15 * 60 * 1000;
const WINDOW_DAYS = 14;
const BILLING_LAST_GENERATED_KEY = 'billing_last_generated';

async function runOnce(): Promise<void> {
  const to = new Date();
  const from = new Date(to.getTime() - WINDOW_DAYS * 86_400_000);
  const result = await generateLineItems({
    dateFrom: from.toISOString(),
    dateTo: to.toISOString(),
    scopeRestricted: false,
  });
  // Same marker the manual route writes, so "Billing updated Xm ago" in the
  // portal reflects automatic runs too.
  const value = JSON.stringify({
    at: to.toISOString(),
    dateFrom: from.toISOString(),
    dateTo: to.toISOString(),
    generated: result.generated,
    total: result.total,
    by: 'auto',
  });
  await db
    .insert(settings)
    .values({ key: BILLING_LAST_GENERATED_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
  if (result.generated > 0) {
    console.info('[billing-auto] generated', { generated: result.generated, total: result.total });
  }
}

let timer: NodeJS.Timeout | null = null;
let running = false;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await runOnce();
  } catch (err) {
    console.warn('[billing-auto] generation failed:', err instanceof Error ? err.message : err);
  } finally {
    running = false;
  }
}

export function startBillingAutoGenerate(): void {
  if (timer) return;
  console.log('[worker] starting billing auto-generation (every 15m, 14-day window)');
  timer = setInterval(() => void tick(), INTERVAL_MS);
  void tick();
}

export function stopBillingAutoGenerate(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
