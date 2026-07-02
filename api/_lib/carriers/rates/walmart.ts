// @ts-nocheck
// Extracted verbatim from api/carriers/rates.ts (C1 decomposition). The rates
// endpoint handler dispatches here; behavior is unchanged.
import { timedFetch } from '../../../../src/lib/http/timing.js';

// ───────── Walmart Shipping Solutions / Sponsored Carrier ─────────
// Walmart exposes per-order shipping rates via the Marketplace API. There
// is no generic "rate-shop arbitrary package" endpoint; the rates returned
// reflect Walmart's negotiated pricing for a specific Walmart order. So
// this branch only works when the caller passes a Walmart purchaseOrderId
// (extracted from the orders.external_order_id we ingested as
// `walmart-<purchaseOrderId>`).
async function getWalmartAccessTokenForRates(creds: Record<string, unknown>): Promise<string> {
  const clientId = String(creds?.clientId ?? '').trim();
  const clientSecret = String(creds?.clientSecret ?? '').trim();
  if (!clientId || !clientSecret) {
    throw new Error('Walmart clientId and clientSecret are required');
  }
  const channelType = String(creds?.channelType ?? '').trim();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const correlationId = `prepship-${Date.now().toString(36)}`;
  const headers: Record<string, string> = {
    Authorization: `Basic ${basic}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
    'WM_QOS.CORRELATION_ID': correlationId,
    'WM_SVC.NAME': 'Walmart Marketplace',
  };
  if (channelType) headers['WM_CONSUMER.CHANNEL.TYPE'] = channelType;
  const res = await timedFetch('api.carriers.rates.external', 'https://marketplace.walmartapis.com/v3/token', {
    method: 'POST',
    headers,
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    const t = await res.text().then((s) => s.slice(0, 300)).catch(() => '');
    throw new Error(`Walmart OAuth ${res.status}: ${t || res.statusText}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data?.access_token) throw new Error('Walmart OAuth response missing access_token');
  return data.access_token;
}

// Fix 4 (2026-05-12): on-demand Walmart Marketplace lookup of a single
// order by its customer order number. The Shipping Estimates API requires
// `purchaseOrderId` (Walmart's short internal id) but our `orders` table
// often only has the customer-facing `customerOrderNumber` (the long
// 2000… number that the buyer sees) — especially when the order was
// ingested via ShipStation instead of via the direct Marketplace pull.
//
// Returns { purchaseOrderId, rawOrder } on success, or null on any failure
// (no match, network/auth error, missing creds, etc). Caller falls back
// to the existing error path so a flaky lookup never breaks the request.
export async function lookupWalmartOrderByCustomerOrderId(
  creds: Record<string, unknown>,
  customerOrderId: string,
): Promise<{ purchaseOrderId: string; rawOrder: any } | null> {
  const clientId = String(creds?.clientId ?? '').trim();
  const clientSecret = String(creds?.clientSecret ?? '').trim();
  if (!clientId || !clientSecret) return null;
  // Only attempt this for things that *look* like a Walmart customer
  // order number (long, all digits). Avoids burning OAuth tokens on
  // ShipStation order numbers, eBay ids, etc.
  const trimmed = customerOrderId.trim();
  if (!/^\d{8,}$/.test(trimmed)) return null;

  let token: string;
  try {
    token = await getWalmartAccessTokenForRates(creds);
  } catch (err) {
    console.warn('[carriers/rates] walmart token (lookup) failed:', err instanceof Error ? err.message : err);
    return null;
  }

  const channelType = String(creds?.channelType ?? '').trim();
  const partnerId = String(creds?.partnerId ?? creds?.sellerId ?? '').trim();
  const correlationId = `prepship-lookup-${Date.now().toString(36)}`;
  const headers: Record<string, string> = {
    'WM_SEC.ACCESS_TOKEN': token,
    'WM_QOS.CORRELATION_ID': correlationId,
    'WM_SVC.NAME': 'Walmart Marketplace',
    'WM_MARKET': 'us',
    Accept: 'application/json',
  };
  if (channelType) headers['WM_CONSUMER.CHANNEL.TYPE'] = channelType;
  if (partnerId) headers['WM_PARTNER.ID'] = partnerId;

  // Walmart's /v3/orders accepts `customerOrderId` as a query filter.
  // productInfo=true keeps the response rich enough to use as `rawOrder`
  // (item names, addresses, shipping info) so the Shipping Estimates
  // call right after has everything it needs to build the request body.
  const url = new URL('https://marketplace.walmartapis.com/v3/orders');
  url.searchParams.set('customerOrderId', trimmed);
  url.searchParams.set('productInfo', 'true');

  try {
    const res = await timedFetch('api.carriers.rates.external', url.toString(), { headers });
    if (!res.ok) {
      const t = await res.text().then((s) => s.slice(0, 200)).catch(() => '');
      console.warn(`[carriers/rates] walmart /v3/orders lookup ${res.status}: ${t || res.statusText}`);
      return null;
    }
    const data = (await res.json()) as { list?: { elements?: { order?: unknown[] | unknown } } };
    const elementsRaw = (data?.list?.elements as { order?: unknown[] | unknown } | undefined)?.order;
    const elements = Array.isArray(elementsRaw)
      ? elementsRaw
      : elementsRaw
        ? [elementsRaw]
        : [];
    const match = elements.find((o) => {
      const recordedCust = (o as { customerOrderId?: unknown })?.customerOrderId;
      return recordedCust != null && String(recordedCust) === trimmed;
    }) ?? elements[0];
    if (!match) return null;
    const purchaseOrderId = (match as { purchaseOrderId?: unknown })?.purchaseOrderId;
    if (purchaseOrderId == null || String(purchaseOrderId).trim() === '') return null;
    return { purchaseOrderId: String(purchaseOrderId), rawOrder: match };
  } catch (err) {
    console.warn('[carriers/rates] walmart /v3/orders lookup error:', err instanceof Error ? err.message : err);
    return null;
  }
}

// Ship With Walmart "Shipping Estimates" rate quote.
// Real endpoint: POST /v3/shipping/labels/shipping-estimates
// Required body fields:
//   purchaseOrderId, boxDimensions, boxItems[{lineId, sku, quantity}],
//   fromAddress, toAddress, packageType (e.g. CUSTOMER_SUPPLIED).
// We pull the line-item shape from store_orders.raw (already has lineNumber +
// item.sku from the orders pull) so callers don't have to assemble it.
export async function ratesFromWalmartShipping(
  creds: Record<string, unknown>,
  input: {
    weightOz: number;
    purchaseOrderId?: string | null;
    dimsL?: number;
    dimsW?: number;
    dimsH?: number;
    fromZip?: string;
    shipFrom?: any;
    rawOrder?: any; // optional pre-fetched store_orders.raw payload
  },
): Promise<Array<{
  service: string;
  cost: number;
  days: number;
  currency: string;
  carrierCode?: string;
  carrierName?: string;
  carrierType?: string;
}>> {
  if (!input.purchaseOrderId) {
    throw new Error(
      'Walmart Shipping Solutions rates require a Walmart purchaseOrderId. Open the Rate Browser on a Walmart-pulled order (orders whose external id starts with walmart-).',
    );
  }
  if (!input.dimsL || !input.dimsW || !input.dimsH) {
    throw new Error(
      'Walmart Shipping Estimates require box dimensions (length, width, height). Set them in the Rate Browser before fetching rates.',
    );
  }
  const token = await getWalmartAccessTokenForRates(creds);
  const correlationId = `prepship-${Date.now().toString(36)}`;
  const channelType = String(creds?.channelType ?? '').trim();
  const partnerId = String(creds?.partnerId ?? creds?.sellerId ?? '').trim();
  const headers: Record<string, string> = {
    'WM_SEC.ACCESS_TOKEN': token,
    'WM_QOS.CORRELATION_ID': correlationId,
    'WM_SVC.NAME': 'Walmart Marketplace',
    // WM_MARKET is required by some Walmart endpoints (orders, items, returns)
    // even though shipping-estimates docs are silent on it. Sending it is
    // harmless when not needed and rules out a missing-header 500.
    'WM_MARKET': 'us',
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (channelType) headers['WM_CONSUMER.CHANNEL.TYPE'] = channelType;
  if (partnerId) headers['WM_PARTNER.ID'] = partnerId;

  const weightLb = Math.max(0.1, Math.round((input.weightOz / 16) * 10) / 10);

  // Build boxItems from the saved Walmart order's orderLines. Walmart
  // marketplace orders use `lineNumber` consistently — we use the same
  // name in our request body since Walmart's shipping APIs (labels,
  // shipping-estimates, ship-confirm) all key off lineNumber, not lineId.
  const orderLines = Array.isArray(input.rawOrder?.orderLines?.orderLine)
    ? input.rawOrder.orderLines.orderLine
    : [];
  const boxItems = orderLines.length > 0
    ? orderLines.map((line: any) => ({
        lineNumber: String(line?.lineNumber ?? '1'),
        sku: line?.item?.sku ?? '',
        quantity: Number(line?.orderLineQuantity?.amount ?? 1) || 1,
      }))
    : [{ lineNumber: '1', sku: 'UNKNOWN', quantity: 1 }];

  // Walmart's current Shipping Estimates API expects top-level request
  // fields. The important names are not the generic package names used by
  // other carriers: boxWeight/boxLength/boxWidth/boxHeight live inside
  // boxDimensions, and addresses use addressLines[] + state.
  //
  // Ship-from override: Walmart's WSS validates shipFromAddress against
  // the seller's REGISTERED shipping origin in Seller Center. Mismatches
  // return a generic 500. Hardcoded Carson CA only used when the user
  // hasn't pasted their real warehouse on the carrier_account form.
  const credShipFromZip = String(creds?.shipFromZip ?? '').replace(/[^0-9]/g, '').slice(0, 5);
  const shipFromInput = input.shipFrom && typeof input.shipFrom === 'object' ? input.shipFrom : {};
  const fromZip = credShipFromZip ||
    String(shipFromInput?.postalCode ?? input.fromZip ?? '90248').replace(/[^0-9]/g, '').slice(0, 5);
  const fromAddress = {
    name: String(creds?.shipFromName ?? shipFromInput?.name ?? '').trim() || 'Seller',
    addressLines: [
      String(creds?.shipFromAddress1 ?? shipFromInput?.addressLine1 ?? shipFromInput?.street1 ?? '').trim() || 'Warehouse',
      String(creds?.shipFromAddress2 ?? shipFromInput?.addressLine2 ?? shipFromInput?.street2 ?? '').trim(),
    ].filter(Boolean),
    city: String(creds?.shipFromCity ?? shipFromInput?.city ?? '').trim() || 'Carson',
    state: String(creds?.shipFromState ?? shipFromInput?.state ?? '').trim() || 'CA',
    postalCode: fromZip,
    countryCode: String(shipFromInput?.country ?? 'US').trim() || 'US',
    phone: String(creds?.shipFromPhone ?? shipFromInput?.phone ?? '').trim() || '0000000000',
  };

  // Ship-to: Walmart's order payload uses address1/state/country —
  // translate to the shipping-estimates field names here.
  const addr = input.rawOrder?.shippingInfo?.postalAddress ?? {};
  const toAddress = {
    name: addr?.name ?? 'Buyer',
    addressLines: [addr?.address1 ?? '', addr?.address2 ?? ''].filter(Boolean),
    city: addr?.city ?? '',
    state: addr?.state ?? '',
    postalCode: addr?.postalCode ?? '',
    countryCode: addr?.country ?? 'US',
    phone: input.rawOrder?.shippingInfo?.phone ?? '0000000000',
  };

  const toWalmartIsoDate = (value: unknown, fallbackDays: number): string => {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
    if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
    if (typeof value === 'string' && value.trim()) {
      const numeric = Number(value);
      if (Number.isFinite(numeric) && numeric > 0) return new Date(numeric).toISOString();
      const parsed = new Date(value);
      if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
    return new Date(Date.now() + fallbackDays * 24 * 60 * 60 * 1000).toISOString();
  };

  const shipByDate = toWalmartIsoDate(input.rawOrder?.shippingInfo?.estimatedShipDate, 1);
  const deliverByDate = toWalmartIsoDate(input.rawOrder?.shippingInfo?.estimatedDeliveryDate, 5);

  const body = {
    purchaseOrderId: input.purchaseOrderId,
    boxDimensions: {
      boxWeight: weightLb,
      boxWeightUnit: 'LB',
      boxLength: input.dimsL,
      boxWidth: input.dimsW,
      boxHeight: input.dimsH,
      boxDimensionUnit: 'IN',
    },
    fromAddress,
    toAddress,
    packageType: 'CUSTOM_PACKAGE',
    shipByDate,
    deliverByDate,
    includeServicesNotMeetingDeliveryPromise: true,
    boxItems,
    addOns: false,
    hasBattery: false,
  };

  const url = 'https://marketplace.walmartapis.com/v3/shipping/labels/shipping-estimates';
  const res = await timedFetch('api.carriers.rates.external', url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().then((s) => s.slice(0, 800)).catch(() => '');
    // Include a compact summary of what we actually sent — without
    // sensitive values — so a 400 from Walmart can be diagnosed against
    // their schema without a redeploy. The full body is too noisy to
    // include verbatim, so we show a fingerprint of the structure.
    let walmartMessage = t || res.statusText;
    try {
      const parsed = JSON.parse(t) as { errors?: Array<{ info?: string; code?: string; description?: string }> };
      const first = parsed.errors?.[0];
      walmartMessage = first?.info || first?.description || first?.code || walmartMessage;
    } catch {
      // Keep Walmart's raw text fallback when it is not JSON.
    }
    const sentSummary = {
      purchaseOrderId: input.purchaseOrderId,
      packageType: (body as any).packageType,
      boxDimensionKeys: Object.keys((body as any).boxDimensions ?? {}),
      fromAddressKeys: Object.keys((body as any).fromAddress ?? {}),
      toAddressKeys: Object.keys((body as any).toAddress ?? {}),
      boxItemKeys: Object.keys(boxItems[0] ?? {}),
      itemCount: boxItems.length,
      topLevelKeys: Object.keys(body),
      // Capture the actual values we resolved for ship-from — most likely
      // place a 500 hides. If the seller's registered origin is e.g.
      // Phoenix AZ but we sent CA, this will reveal it without leaking
      // anything sensitive.
      fromCity: (body as any).fromAddress?.city,
      fromState: (body as any).fromAddress?.state,
      fromZip: (body as any).fromAddress?.postalCode,
    };
    throw new Error(
      `Walmart Shipping Estimates ${res.status}: ${walmartMessage} | sent: ${JSON.stringify(sentSummary)}`,
    );
  }
  const data = (await res.json()) as any;
  // Response shape per Walmart docs: an array of rate options, each with
  // carrier shortName, serviceType, cost, ETA, addOns. The docs vary on
  // the wrapper field; we probe a few likely shapes.
  const rateList: any[] =
    (Array.isArray(data?.data?.estimates) && data.data.estimates) ||
    (Array.isArray(data?.shippingEstimates) && data.shippingEstimates) ||
    (Array.isArray(data?.rates) && data.rates) ||
    (Array.isArray(data?.estimates) && data.estimates) ||
    (Array.isArray(data?.payload) && data.payload) ||
    (Array.isArray(data) ? data : []);

  return rateList
    .map((r: any) => {
      const carrierName = String(
        r?.carrierName ?? r?.carrier?.shortName ?? r?.carrierShortName ?? r?.carrier ?? r?.carrierDisplayName ?? 'Walmart',
      );
      const carrierDisplay = String(
        r?.carrierDisplayName ?? r?.carrierFullName ?? carrierName,
      );
      const carrierServiceType = String(
        r?.name ?? r?.serviceType ?? r?.carrierServiceType ?? r?.serviceLevel ?? r?.method ?? r?.displayName ?? '',
      );
      const svcType = String(
        r?.displayName ?? r?.serviceTypeGroupDisplayName ?? carrierServiceType,
      );
      const service = svcType ? `${carrierDisplay} ${svcType}` : carrierDisplay;
      const cost = Number(
        r?.estimatedRate?.amount ?? r?.totalCost?.amount ?? r?.cost?.amount ?? r?.totalCost ?? r?.cost ?? r?.amount ?? 0,
      );
      const currency = String(
        r?.estimatedRate?.currency ?? r?.totalCost?.currency ?? r?.cost?.currency ?? r?.currency ?? 'USD',
      );
      const days = Number(r?.transitTime?.businessDays ?? r?.transitDays ?? r?.deliveryDays ?? 0) || 0;
      return {
        service,
        cost,
        days,
        currency,
        carrierCode: carrierName,
        carrierName,
        carrierType: carrierServiceType,
      };
    })
    .filter((r) => r.cost > 0);
}
