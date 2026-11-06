import { env } from '../env';

/** Thin transport adapter to PrepShip's clientUsedPackagePricingRows owner.
 * Visibility (including used free boxes) stays in PrepShip. Never fall back to
 * the full catalog when that owner is unavailable. Internal costs stop here. */
export async function fetchRelevantClientPackageIds(
  clientId: number, authorization: string, requestId?: string,
): Promise<Set<number>> {
  if (!env.PREPSHIP_API_URL || !authorization) throw new Error('Client packaging unavailable');
  const url = `${env.PREPSHIP_API_URL.replace(/\/+$/, '')}/billing/package-prices?clientId=${clientId}`;
  const response = await fetch(url, {
    headers: { authorization, accept: 'application/json', ...(requestId ? { 'x-request-id': requestId } : {}) },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error('Client packaging unavailable');
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || !('data' in body) || !Array.isArray(body.data)) {
    throw new Error('Invalid client packaging response');
  }
  const ids = new Set<number>();
  for (const row of body.data) {
    if (!row || typeof row !== 'object') throw new Error('Invalid client packaging row');
    // Unmatched shipment dimensions have no catalog identity/published price.
    if (row.packageId === null && row.needsPackageCreation === true) continue;
    if (!Number.isSafeInteger(row.packageId) || row.packageId <= 0 || ids.has(row.packageId)) {
      throw new Error('Invalid client packaging identity');
    }
    ids.add(row.packageId);
  }
  return ids;
}
