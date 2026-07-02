// @ts-nocheck
// Extracted verbatim from api/carriers/rates.ts (C1 decomposition). The rates
// endpoint handler dispatches here; behavior is unchanged.
import { timedFetch } from '../../../../src/lib/http/timing.js';

// ───────── UPS Rating API (production) ─────────
// OAuth client_credentials → bearer access token → POST /api/rating/v2403/Shop
// Returns one rate per available service. "Shop" mode asks UPS to compute
// every service we're entitled to with this shipment; we map each one into
// our standard {service, cost, days, currency} shape.
const UPS_SERVICE_NAMES: Record<string, string> = {
  '01': 'UPS Next Day Air',
  '02': 'UPS 2nd Day Air',
  '03': 'UPS Ground',
  '07': 'UPS Worldwide Express',
  '08': 'UPS Worldwide Expedited',
  '11': 'UPS Standard',
  '12': 'UPS 3 Day Select',
  '13': 'UPS Next Day Air Saver',
  '14': 'UPS Next Day Air Early',
  '54': 'UPS Worldwide Express Plus',
  '59': 'UPS 2nd Day Air A.M.',
  '65': 'UPS Saver',
  '92': 'UPS Ground Saver',
  '93': 'UPS SurePost 1 lb or Greater',
};

async function getUpsAccessToken(creds: Record<string, unknown>): Promise<string> {
  const clientId = String(creds?.clientId ?? '').trim();
  const clientSecret = String(creds?.clientSecret ?? '').trim();
  if (!clientId || !clientSecret) {
    throw new Error('UPS clientId and clientSecret are required');
  }
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await timedFetch('api.carriers.rates.external', 'https://onlinetools.ups.com/security/v1/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    const t = await res.text().then((s) => s.slice(0, 300)).catch(() => '');
    throw new Error(`UPS OAuth ${res.status}: ${t || res.statusText}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data?.access_token) throw new Error('UPS OAuth response missing access_token');
  return data.access_token;
}

export async function ratesFromUps(
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
  if (!accountNumber) throw new Error('UPS accountNumber is required');
  if (!input.toZip) throw new Error('toZip is required for UPS rate quotes');

  const token = await getUpsAccessToken(creds);

  // UPS expects weight in pounds; convert from ounces (round to 1 decimal).
  const weightLb = Math.max(0.1, Math.round((input.weightOz / 16) * 10) / 10);
  // Sensible ship-from default if the caller didn't pass one — same warehouse
  // ZIP the rest of the codebase uses (90248, the GWH location).
  const fromZip = (input.fromZip || '90248').replace(/[^0-9]/g, '').slice(0, 5);
  const toZip = String(input.toZip).replace(/[^0-9]/g, '').slice(0, 5);

  const dims = (input.dimsL && input.dimsW && input.dimsH)
    ? {
        UnitOfMeasurement: { Code: 'IN' },
        Length: String(input.dimsL),
        Width: String(input.dimsW),
        Height: String(input.dimsH),
      }
    : undefined;

  const body = {
    RateRequest: {
      Request: {
        TransactionReference: { CustomerContext: 'prepship-rates' },
        RequestOption: 'Shop',
      },
      Shipment: {
        Shipper: {
          ShipperNumber: accountNumber,
          Address: { PostalCode: fromZip, CountryCode: 'US' },
        },
        ShipFrom: {
          Address: { PostalCode: fromZip, CountryCode: 'US' },
        },
        ShipTo: {
          Address: { PostalCode: toZip, CountryCode: 'US' },
        },
        Package: {
          PackagingType: { Code: '02' }, // 02 = customer-supplied package
          ...(dims ? { Dimensions: dims } : {}),
          PackageWeight: {
            UnitOfMeasurement: { Code: 'LBS' },
            Weight: String(weightLb),
          },
        },
      },
    },
  };

  const res = await timedFetch('api.carriers.rates.external', 'https://onlinetools.ups.com/api/rating/v2403/Shop', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      transId: `prepship-${Date.now().toString(36)}`,
      transactionSrc: 'prepship',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().then((s) => s.slice(0, 600)).catch(() => '');
    throw new Error(`UPS Rating ${res.status}: ${t || res.statusText}`);
  }
  const data = (await res.json()) as {
    RateResponse?: {
      RatedShipment?: Array<{
        Service?: { Code?: string; Description?: string };
        TotalCharges?: { MonetaryValue?: string; CurrencyCode?: string };
        GuaranteedDelivery?: { BusinessDaysInTransit?: string };
      } | undefined> | { Service?: unknown } | undefined;
    };
  };
  // UPS returns either an array (multiple services) or a single object — normalize.
  const rated = data?.RateResponse?.RatedShipment;
  const list: any[] = Array.isArray(rated) ? rated : rated ? [rated] : [];

  return list.map((row: any) => {
    const code = String(row?.Service?.Code ?? '');
    const service = UPS_SERVICE_NAMES[code]
      ?? row?.Service?.Description
      ?? `UPS Service ${code || '?'}`;
    const cost = Number(row?.TotalCharges?.MonetaryValue ?? 0);
    const currency = String(row?.TotalCharges?.CurrencyCode ?? 'USD');
    const days = Number(row?.GuaranteedDelivery?.BusinessDaysInTransit ?? 0) || 0;
    return { service, cost, days, currency };
  }).filter((r) => r.cost > 0);
}
