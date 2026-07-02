// @ts-nocheck
// Extracted verbatim from api/carriers/rates.ts (C1 decomposition). The rates
// endpoint handler dispatches here; behavior is unchanged.
import { timedFetch } from '../../../../src/lib/http/timing.js';

// ───────── Amazon Buy Shipping (SP-API Shipping v2) ─────────
// Real endpoint: POST https://sellingpartnerapi-na.amazon.com/shipping/v2/shipments/rates
// Auth: LWA refresh_token → access_token (no AWS Sigv4 — Amazon dropped that
// requirement in April 2024; only x-amz-access-token header is needed now).
//
// Required body:
//   shipDate, shipFrom, shipTo, packages[], channelDetails.channelType
// channelType:
//   "AMAZON" — for Amazon-marketplace orders (use amazonOrderId in body)
//   "EXTERNAL" — for any other order (Shopify, eBay, etc., or demo calls)
//
// Buy Shipping rates work without a real order, unlike Walmart's
// shipping-estimates — so the Settings demo button can call this directly
// with placeholder shipTo and get back genuine quotes.
export async function ratesFromAmazonBuyShipping(
  creds: Record<string, unknown>,
  input: {
    weightOz: number;
    toZip?: string;
    fromZip?: string;
    dimsL?: number;
    dimsW?: number;
    dimsH?: number;
    rawOrder?: any;
    externalOrderId?: string | null;
  },
): Promise<Array<{ service: string; cost: number; days: number; currency: string }>> {
  const lwaClientId = String(creds?.lwaClientId ?? '').trim();
  const lwaClientSecret = String(creds?.lwaClientSecret ?? '').trim();
  const refreshToken = String(creds?.refreshToken ?? '').trim();
  if (!lwaClientId || !lwaClientSecret || !refreshToken) {
    throw new Error('Amazon Buy Shipping requires lwaClientId, lwaClientSecret, refreshToken on the carrier_account credentials.');
  }
  if (!input.dimsL || !input.dimsW || !input.dimsH) {
    throw new Error('Amazon Buy Shipping requires box dimensions (length, width, height). Set them in the Rate Browser before fetching rates.');
  }

  // 1) LWA refresh → access token. Same flow as the verifier.
  const lwaBody = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: lwaClientId,
    client_secret: lwaClientSecret,
  });
  const lwaRes = await timedFetch('api.carriers.rates.external', 'https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: lwaBody.toString(),
  });
  if (!lwaRes.ok) {
    const t = await lwaRes.text().then((s) => s.slice(0, 200)).catch(() => '');
    throw new Error(`Amazon LWA ${lwaRes.status}: ${t || lwaRes.statusText}`);
  }
  const lwaJson = (await lwaRes.json()) as { access_token?: string };
  if (!lwaJson?.access_token) throw new Error('Amazon LWA response missing access_token');

  // 2) Build the rate request. shipFrom uses the seller's configured
  // origin (we hardcode a CA default, same as the Walmart quoter — Amazon
  // Buy Shipping rates don't depend on shipFrom matching a registered
  // address as much as Walmart's WSS does, so a generic LA-area shipper
  // works for the Settings demo case).
  const fromZip = (input.fromZip || '90248').replace(/[^0-9]/g, '').slice(0, 5);
  const shipFrom = {
    name: 'Seller',
    addressLine1: 'Warehouse',
    city: 'Carson',
    stateOrRegion: 'CA',
    postalCode: fromZip,
    countryCode: 'US',
    phoneNumber: '0000000000',
  };

  // shipTo: prefer the saved order's address if we have one; fall back
  // to a generic Oakland CA address keyed off toZip for the Settings
  // demo button. Amazon's Buy Shipping API requires a full address —
  // zip alone won't validate.
  const orderAddr = input.rawOrder?.ShippingAddress ?? input.rawOrder?.shippingAddress ?? null;
  const shipTo = orderAddr
    ? {
        name: orderAddr.Name ?? orderAddr.name ?? 'Buyer',
        addressLine1: orderAddr.AddressLine1 ?? orderAddr.addressLine1 ?? '',
        addressLine2: orderAddr.AddressLine2 ?? orderAddr.addressLine2 ?? '',
        city: orderAddr.City ?? orderAddr.city ?? '',
        stateOrRegion: orderAddr.StateOrRegion ?? orderAddr.stateOrRegion ?? '',
        postalCode: orderAddr.PostalCode ?? orderAddr.postalCode ?? '',
        countryCode: orderAddr.CountryCode ?? orderAddr.countryCode ?? 'US',
        phoneNumber: orderAddr.Phone ?? orderAddr.phone ?? '0000000000',
      }
    : {
        name: 'Buyer',
        addressLine1: '1 Main St',
        city: 'Oakland',
        stateOrRegion: 'CA',
        postalCode: (input.toZip || '94601').replace(/[^0-9]/g, '').slice(0, 5),
        countryCode: 'US',
        phoneNumber: '0000000000',
      };

  // Buy Shipping uses INCH/POUND uppercase strings.
  const weightLb = Math.max(0.1, Math.round((input.weightOz / 16) * 10) / 10);
  const packages = [
    {
      packageClientReferenceId: '1',
      dimensions: {
        length: input.dimsL,
        width: input.dimsW,
        height: input.dimsH,
        unit: 'INCH',
      },
      weight: { value: weightLb, unit: 'POUND' },
    },
  ];

  // Determine channel: if this is an Amazon order, use AMAZON + amazonOrderId.
  // Otherwise EXTERNAL (Settings demo, or non-Amazon marketplaces).
  const ext = input.externalOrderId ?? '';
  const isAmazonOrder = typeof ext === 'string' && ext.startsWith('amazon-');
  const amazonOrderId = isAmazonOrder ? ext.slice('amazon-'.length) : null;
  const channelDetails = isAmazonOrder
    ? { channelType: 'AMAZON', amazonOrderDetails: { amazonOrderId } }
    : { channelType: 'EXTERNAL' };

  // Ship date defaults to today; Buy Shipping accepts ISO-8601 with timezone.
  const shipDate = new Date().toISOString();

  const body = {
    shipDate,
    shipFrom,
    shipTo,
    packages,
    channelDetails,
  };

  // SP-API endpoint host varies by region (NA / EU / FE). Using NA since
  // marketplaceId ATVPDKIKX0DER (US) is the only one we currently support.
  // If the seller adds non-NA marketplaces, route on marketplaceId here.
  const url = 'https://sellingpartnerapi-na.amazon.com/shipping/v2/shipments/rates';
  const apiRes = await timedFetch('api.carriers.rates.external', url, {
    method: 'POST',
    headers: {
      'x-amz-access-token': lwaJson.access_token!,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!apiRes.ok) {
    const t = await apiRes.text().then((s) => s.slice(0, 800)).catch(() => '');
    const sentSummary = {
      hasShipFrom: !!shipFrom,
      hasShipTo: !!shipTo,
      packageCount: packages.length,
      channelType: channelDetails.channelType,
      shipFromKeys: Object.keys(shipFrom),
      shipToKeys: Object.keys(shipTo),
    };
    throw new Error(
      `Amazon Buy Shipping ${apiRes.status}: ${t || apiRes.statusText} | sent: ${JSON.stringify(sentSummary)}`,
    );
  }
  const data = (await apiRes.json()) as any;

  // Buy Shipping v2 wraps rates under either `rates` or `rateGroups[].rates`.
  // Normalize to a flat list.
  const flat: any[] = [];
  if (Array.isArray(data?.rates)) flat.push(...data.rates);
  if (Array.isArray(data?.payload?.rates)) flat.push(...data.payload.rates);
  if (Array.isArray(data?.rateGroups)) {
    for (const g of data.rateGroups) {
      if (Array.isArray(g?.rates)) flat.push(...g.rates);
    }
  }
  if (Array.isArray(data?.payload?.rateGroups)) {
    for (const g of data.payload.rateGroups) {
      if (Array.isArray(g?.rates)) flat.push(...g.rates);
    }
  }

  return flat
    .map((r: any) => {
      const carrier = String(r?.carrierName ?? r?.carrier?.name ?? r?.carrier ?? 'Amazon');
      const svc = String(r?.serviceName ?? r?.service?.name ?? r?.serviceLevel ?? '');
      const service = svc ? `${carrier} ${svc}` : carrier;
      const cost = Number(
        r?.totalCharge?.value ??
          r?.totalCharge?.amount ??
          r?.billedWeight?.value ??
          r?.amount ??
          0,
      );
      const currency = String(
        r?.totalCharge?.unit ?? r?.totalCharge?.currency ?? r?.currency ?? 'USD',
      );
      // Buy Shipping returns deliveryWindow start/end ISO timestamps; convert
      // to "days from today" for display parity with the other carriers.
      const promise = r?.promise?.deliveryWindow ?? r?.promise ?? null;
      const endDate = promise?.end ?? promise?.latest ?? null;
      const days = endDate
        ? Math.max(
            1,
            Math.round((new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
          )
        : 0;
      return { service, cost, days, currency };
    })
    .filter((r) => r.cost > 0);
}
