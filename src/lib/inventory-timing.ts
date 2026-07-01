/** Slow-route timing instrumentation shared by the inventory route + services
 *  (extracted verbatim from routes/inventory.ts). */

export type InventoryRouteTimings = Record<string, number>;

export function msSince(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}

export async function timedInventoryStep<T>(
  timings: InventoryRouteTimings,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await fn();
  } finally {
    timings[name] = msSince(startedAt);
  }
}

export function logSlowInventoryRoute(
  route: string,
  timings: InventoryRouteTimings,
  totalMs: number,
  meta: Record<string, unknown>,
): void {
  const slowestStepMs = Math.max(0, ...Object.values(timings));
  if (totalMs < 750 && slowestStepMs < 500) return;
  console.info(`[inventory:${route}] completed`, {
    ...meta,
    totalMs,
    timings,
  });
}
