// @ts-nocheck
// Extracted verbatim from api/carriers/rates.ts (C1 decomposition). The rates
// endpoint handler dispatches here; behavior is unchanged.
import { timedFetch } from '../../../../src/lib/http/timing.js';

// ───────── EasyPost (multi-carrier aggregator) ─────────
// Real endpoint: POST https://api.easypost.com/v2/shipments
// Auth: HTTP Basic with the API key as the username, empty password.
// One call returns rates from EVERY carrier the user has connected to
// their EasyPost account (UPS, USPS, FedEx, DHL, etc.) — much simpler
// than wiring per-carrier integrations. EasyPost handles all the carrier
// OAuth/credential management on their side.
export async function ratesFromEasyPost(
  creds: Record<string, unknown>,
  input: {
    weightOz: number;
    toZip?: string;
    fromZip?: string;
    dimsL?: number;
    dimsW?: number;
    dimsH?: number;
    rawOrder?: any;
  },
): Promise<Array<{ service: string; cost: number; days: number; currency: string }>> {
  const apiKey = String(creds?.apiKey ?? '').trim();
  if (!apiKey) {
    throw new Error('EasyPost requires apiKey on the carrier_account credentials.');
  }
  if (!input.dimsL || !input.dimsW || !input.dimsH) {
    throw new Error('EasyPost rate quotes require box dimensions (length, width, height).');
  }

  // EasyPost API key as Basic Auth username, empty password (the trailing
  // colon after the key matters — without it the API returns 401).
  const basic = Buffer.from(`${apiKey}:`).toString('base64');
  const headers = {
    Authorization: `Basic ${basic}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  // Ship-from: prefer per-account override, fall back to a Carson CA
  // default (matches the convention used by other quoters in this file).
  const credShipFromZip = String(creds?.shipFromZip ?? '').replace(/[^0-9]/g, '').slice(0, 5);
  const fromZip = credShipFromZip || (input.fromZip || '90248').replace(/[^0-9]/g, '').slice(0, 5);
  const fromAddress = {
    name: String(creds?.shipFromName ?? '').trim() || 'Seller',
    street1: String(creds?.shipFromAddress1 ?? '').trim() || 'Warehouse',
    city: String(creds?.shipFromCity ?? '').trim() || 'Carson',
    state: String(creds?.shipFromState ?? '').trim() || 'CA',
    zip: fromZip,
    country: 'US',
    phone: String(creds?.shipFromPhone ?? '').trim() || '0000000000',
  };

  // Ship-to: try the saved order address first; fall back to a generic
  // Oakland CA address keyed off toZip for the Settings demo button.
  // EasyPost requires a full address — zip alone won't validate.
  const orderAddr =
    input.rawOrder?.shippingInfo?.postalAddress ?? // walmart shape
    input.rawOrder?.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo?.contactAddress ?? // ebay shape
    input.rawOrder?.ShippingAddress ?? // amazon shape
    null;
  const toAddress = orderAddr
    ? {
        name: orderAddr.name ?? orderAddr.fullName ?? orderAddr.Name ?? 'Buyer',
        street1: orderAddr.address1 ?? orderAddr.addressLine1 ?? orderAddr.AddressLine1 ?? '',
        street2: orderAddr.address2 ?? orderAddr.addressLine2 ?? orderAddr.AddressLine2 ?? '',
        city: orderAddr.city ?? orderAddr.City ?? '',
        state: orderAddr.state ?? orderAddr.stateOrProvince ?? orderAddr.StateOrRegion ?? '',
        zip: orderAddr.postalCode ?? orderAddr.PostalCode ?? '',
        country: orderAddr.country ?? orderAddr.countryCode ?? orderAddr.CountryCode ?? 'US',
        phone: orderAddr.phone ?? orderAddr.Phone ?? '0000000000',
      }
    : {
        name: 'Buyer',
        street1: '1 Main St',
        city: 'Oakland',
        state: 'CA',
        zip: (input.toZip || '94601').replace(/[^0-9]/g, '').slice(0, 5),
        country: 'US',
        phone: '0000000000',
      };

  // EasyPost's parcel takes weight in OUNCES (despite some carriers
  // wanting LB internally — EasyPost normalizes). Dimensions in inches.
  const parcel = {
    length: input.dimsL,
    width: input.dimsW,
    height: input.dimsH,
    weight: input.weightOz,
  };

  const body = {
    shipment: {
      from_address: fromAddress,
      to_address: toAddress,
      parcel,
    },
  };

  const res = await timedFetch('api.carriers.rates.external', 'https://api.easypost.com/v2/shipments', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().then((s) => s.slice(0, 800)).catch(() => '');
    throw new Error(`EasyPost ${res.status}: ${t || res.statusText}`);
  }
  const data = (await res.json()) as any;
  const rateList: any[] = Array.isArray(data?.rates) ? data.rates : [];

  // Sort by cost ascending so the cheapest rate appears first — matches
  // user expectation when scanning rate-shopping results.
  return rateList
    .map((r: any) => ({
      service: `${r.carrier ?? 'EasyPost'} ${r.service ?? ''}`.trim(),
      cost: Number(r.rate ?? 0),
      days: Number(r.delivery_days ?? r.est_delivery_days ?? 0) || 0,
      currency: String(r.currency ?? 'USD'),
    }))
    .filter((r) => r.cost > 0)
    .sort((a, b) => a.cost - b.cost);
}
