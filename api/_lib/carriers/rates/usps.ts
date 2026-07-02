// @ts-nocheck
// Extracted verbatim from api/carriers/rates.ts (C1 decomposition). The rates
// endpoint handler dispatches here; behavior is unchanged.
import { timedFetch } from '../../../../src/lib/http/timing.js';

// ───────── USPS APIs v3 (Domestic Prices) ─────────
// USPS v3 doesn't return all service rates in one call — each mail class
// requires a separate request. We fan out to the most common domestic
// classes in parallel and merge.
const USPS_MAIL_CLASSES = [
  { class: 'USPS_GROUND_ADVANTAGE', label: 'USPS Ground Advantage' },
  { class: 'PRIORITY_MAIL',        label: 'USPS Priority Mail' },
  { class: 'PRIORITY_MAIL_EXPRESS', label: 'USPS Priority Mail Express' },
] as const;

async function getUspsAccessToken(creds: Record<string, unknown>): Promise<string> {
  const consumerKey = String(creds?.consumerKey ?? '').trim();
  const consumerSecret = String(creds?.consumerSecret ?? '').trim();
  if (!consumerKey || !consumerSecret) {
    throw new Error('USPS consumerKey and consumerSecret are required');
  }
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: consumerKey,
    client_secret: consumerSecret,
  });
  const res = await timedFetch('api.carriers.rates.external', 'https://apis.usps.com/oauth2/v3/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const t = await res.text().then((s) => s.slice(0, 300)).catch(() => '');
    throw new Error(`USPS OAuth ${res.status}: ${t || res.statusText}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data?.access_token) throw new Error('USPS OAuth response missing access_token');
  return data.access_token;
}

export async function ratesFromUsps(
  creds: Record<string, unknown>,
  input: {
    weightOz: number;
    toZip?: string;
    fromZip?: string;
    dimsL?: number;
    dimsW?: number;
    dimsH?: number;
  },
): Promise<Array<{ service: string; cost: number; days: number; currency: string }>> {
  if (!input.toZip) throw new Error('toZip is required for USPS rate quotes');

  const token = await getUspsAccessToken(creds);
  // USPS expects weight in pounds (decimal).
  const weightLb = Math.max(0.0625, Math.round((input.weightOz / 16) * 100) / 100);
  const fromZip = (input.fromZip || '90248').replace(/[^0-9]/g, '').slice(0, 5);
  const toZip = String(input.toZip).replace(/[^0-9]/g, '').slice(0, 5);
  const length = input.dimsL ?? 6;
  const width = input.dimsW ?? 6;
  const height = input.dimsH ?? 4;

  // Fan out one request per mail class. Each succeeds or fails independently
  // (one class not eligible for the shipment shouldn't kill the whole quote).
  const results = await Promise.all(
    USPS_MAIL_CLASSES.map(async ({ class: mailClass, label }) => {
      try {
        const body = {
          originZIPCode: fromZip,
          destinationZIPCode: toZip,
          weight: weightLb,
          length, width, height,
          mailClass,
          processingCategory: 'MACHINABLE',
          rateIndicator: 'DR',
          destinationEntryFacilityType: 'NONE',
          priceType: 'COMMERCIAL',
        };
        const res = await timedFetch('api.carriers.rates.external', 'https://apis.usps.com/prices/v3/base-rates/search', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as any;
        // USPS returns either a top-level `rates` array or a single rate object.
        const rates: any[] = Array.isArray(data?.rates) ? data.rates : (data?.rate ? [data.rate] : []);
        if (rates.length === 0) {
          const directPrice = Number(data?.totalBasePrice ?? data?.price ?? 0);
          if (directPrice > 0) {
            return { service: label, cost: directPrice, days: 0, currency: 'USD' };
          }
          return null;
        }
        const cheapest = rates
          .map((r: any) => Number(r?.price ?? r?.totalBasePrice ?? 0))
          .filter((n) => n > 0)
          .sort((a, b) => a - b)[0];
        if (!cheapest) return null;
        const days = Number(rates[0]?.deliveryDays ?? 0) || 0;
        return { service: label, cost: cheapest, days, currency: 'USD' };
      } catch {
        return null;
      }
    }),
  );
  return results.filter((r): r is NonNullable<typeof r> => r !== null);
}
