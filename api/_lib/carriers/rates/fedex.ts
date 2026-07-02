// @ts-nocheck
// Extracted verbatim from api/carriers/rates.ts (C1 decomposition). The rates
// endpoint handler dispatches here; behavior is unchanged.
import { timedFetch } from '../../../../src/lib/http/timing.js';

// ───────── FedEx Rate API ─────────
// OAuth client_credentials → Bearer token → POST /rate/v1/rates/quotes.
// "rateRequestType": ["LIST","ACCOUNT"] asks FedEx for both list-rate and
// the seller's account-discounted rate; we surface the lower of the two.
const FEDEX_SERVICE_NAMES: Record<string, string> = {
  FEDEX_GROUND: 'FedEx Ground',
  GROUND_HOME_DELIVERY: 'FedEx Home Delivery',
  FEDEX_2_DAY: 'FedEx 2Day',
  FEDEX_2_DAY_AM: 'FedEx 2Day AM',
  FEDEX_EXPRESS_SAVER: 'FedEx Express Saver',
  STANDARD_OVERNIGHT: 'FedEx Standard Overnight',
  PRIORITY_OVERNIGHT: 'FedEx Priority Overnight',
  FIRST_OVERNIGHT: 'FedEx First Overnight',
  FEDEX_FIRST_FREIGHT: 'FedEx First Freight',
  INTERNATIONAL_PRIORITY: 'FedEx International Priority',
  INTERNATIONAL_ECONOMY: 'FedEx International Economy',
  FEDEX_INTERNATIONAL_GROUND: 'FedEx International Ground',
  SMART_POST: 'FedEx SmartPost',
};

async function getFedexAccessToken(creds: Record<string, unknown>): Promise<string> {
  const apiKey = String(creds?.apiKey ?? '').trim();
  const apiSecret = String(creds?.apiSecret ?? '').trim();
  if (!apiKey || !apiSecret) {
    throw new Error('FedEx apiKey and apiSecret are required');
  }
  const useSandbox = String(creds?.sandbox ?? '').toLowerCase() === 'true';
  const tokenUrl = useSandbox
    ? 'https://apis-sandbox.fedex.com/oauth/token'
    : 'https://apis.fedex.com/oauth/token';
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: apiKey,
    client_secret: apiSecret,
  });
  const res = await timedFetch('api.carriers.rates.external', tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const t = await res.text().then((s) => s.slice(0, 300)).catch(() => '');
    throw new Error(`FedEx OAuth ${res.status}: ${t || res.statusText}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data?.access_token) throw new Error('FedEx OAuth response missing access_token');
  return data.access_token;
}

export async function ratesFromFedex(
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
  const accountNumber = String(creds?.accountNumber ?? '').trim();
  if (!accountNumber) throw new Error('FedEx accountNumber is required');
  if (!input.toZip) throw new Error('toZip is required for FedEx rate quotes');

  const token = await getFedexAccessToken(creds);
  const useSandbox = String(creds?.sandbox ?? '').toLowerCase() === 'true';
  const ratesUrl = useSandbox
    ? 'https://apis-sandbox.fedex.com/rate/v1/rates/quotes'
    : 'https://apis.fedex.com/rate/v1/rates/quotes';

  const weightLb = Math.max(0.1, Math.round((input.weightOz / 16) * 10) / 10);
  const fromZip = (input.fromZip || '90248').replace(/[^0-9]/g, '').slice(0, 5);
  const toZip = String(input.toZip).replace(/[^0-9]/g, '').slice(0, 5);

  const pkg: Record<string, unknown> = {
    weight: { units: 'LB', value: weightLb },
  };
  if (input.dimsL && input.dimsW && input.dimsH) {
    pkg.dimensions = {
      length: input.dimsL,
      width: input.dimsW,
      height: input.dimsH,
      units: 'IN',
    };
  }

  const body = {
    accountNumber: { value: accountNumber },
    rateRequestControlParameters: { returnTransitTimes: true },
    requestedShipment: {
      shipper: { address: { postalCode: fromZip, countryCode: 'US' } },
      recipient: { address: { postalCode: toZip, countryCode: 'US' } },
      pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
      rateRequestType: ['ACCOUNT', 'LIST'],
      requestedPackageLineItems: [pkg],
    },
  };

  const res = await timedFetch('api.carriers.rates.external', ratesUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-locale': 'en_US',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().then((s) => s.slice(0, 600)).catch(() => '');
    throw new Error(`FedEx Rate ${res.status}: ${t || res.statusText}`);
  }
  const data = (await res.json()) as any;
  const replyDetails: any[] = Array.isArray(data?.output?.rateReplyDetails)
    ? data.output.rateReplyDetails
    : [];

  // Transit-time → business-days lookup. FedEx returns enums like TWO_DAYS.
  const transitDays: Record<string, number> = {
    ONE_DAY: 1, TWO_DAYS: 2, THREE_DAYS: 3, FOUR_DAYS: 4, FIVE_DAYS: 5,
    SIX_DAYS: 6, SEVEN_DAYS: 7, EIGHT_DAYS: 8, NINE_DAYS: 9, TEN_DAYS: 10,
    ELEVEN_DAYS: 11, TWELVE_DAYS: 12, THIRTEEN_DAYS: 13, FOURTEEN_DAYS: 14,
    FIFTEEN_DAYS: 15, SIXTEEN_DAYS: 16, SEVENTEEN_DAYS: 17, EIGHTEEN_DAYS: 18,
  };

  return replyDetails
    .map((d: any) => {
      const code = String(d?.serviceType ?? '');
      const service = FEDEX_SERVICE_NAMES[code]
        ?? d?.serviceName
        ?? `FedEx ${code || '?'}`;
      // Pick the lower of ACCOUNT and LIST rates; fall back to whatever's there.
      const shipDetails = Array.isArray(d?.ratedShipmentDetails)
        ? d.ratedShipmentDetails
        : [];
      const charges = shipDetails
        .map((s: any) => Number(s?.totalNetCharge ?? s?.totalNetFedExCharge ?? 0))
        .filter((n: number) => n > 0)
        .sort((a: number, b: number) => a - b);
      const cost = charges[0] ?? 0;
      const currency = String(shipDetails[0]?.currency ?? 'USD');
      const transitKey = String(d?.operationalDetail?.transitTime ?? '');
      const days = transitDays[transitKey] ?? 0;
      return { service, cost, days, currency };
    })
    .filter((r) => r.cost > 0);
}
