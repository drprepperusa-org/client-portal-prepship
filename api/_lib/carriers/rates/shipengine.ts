// @ts-nocheck
// Extracted verbatim from api/carriers/rates.ts (C1 decomposition). The rates
// endpoint handler dispatches here; behavior is unchanged.
import { timedFetch } from '../../../../src/lib/http/timing.js';

// ShipEngine / ShipStation API rate shopping.
async function shipEngineCarrierIds(creds: Record<string, unknown>): Promise<string[]> {
  const explicit = String(creds?.carrierIds ?? creds?.carrier_ids ?? '').trim();
  if (explicit) {
    return explicit
      .split(/[,\s]+/)
      .map((id) => id.trim())
      .filter(Boolean);
  }

  const apiKey = String(creds?.apiKey ?? '').trim();
  if (!apiKey) throw new Error('ShipEngine apiKey is required.');
  const res = await timedFetch('api.carriers.rates.external', 'https://api.shipengine.com/v1/carriers', {
    headers: { 'API-Key': apiKey, Accept: 'application/json' },
  });
  if (!res.ok) {
    const t = await res.text().then((s) => s.slice(0, 500)).catch(() => '');
    throw new Error(`ShipEngine carriers ${res.status}: ${t || res.statusText}`);
  }
  const data = (await res.json()) as any;
  return (Array.isArray(data?.carriers) ? data.carriers : [])
    .filter((carrier: any) => carrier?.connection_status !== 'pending_approval')
    .map((carrier: any) => String(carrier?.carrier_id ?? '').trim())
    .filter(Boolean);
}

export function shipEngineShipTo(rawOrder: any, toZip?: string) {
  const wmAddr = rawOrder?.shippingInfo?.postalAddress ?? null;
  const ebayContact = Array.isArray(rawOrder?.fulfillmentStartInstructions)
    ? rawOrder.fulfillmentStartInstructions[0]?.shippingStep?.shipTo
    : null;
  const ebayAddr = ebayContact?.contactAddress ?? null;
  const amazonAddr = rawOrder?.ShippingAddress ?? null;
  const ssAddr = rawOrder?.shipTo ?? rawOrder?.ship_to ?? null;
  const addr = wmAddr ?? ebayAddr ?? amazonAddr ?? ssAddr;
  const postalCode = String(
    addr?.postalCode ??
      addr?.PostalCode ??
      addr?.postal_code ??
      toZip ??
      '94601',
  ).replace(/[^0-9-]/g, '').slice(0, 10);

  return {
    name: String(
      addr?.name ??
        ebayContact?.fullName ??
        addr?.Name ??
        ssAddr?.name ??
        'Buyer',
    ),
    phone: String(
      rawOrder?.shippingInfo?.phone ??
        ebayContact?.primaryPhone?.phoneNumber ??
        addr?.Phone ??
        ssAddr?.phone ??
        '0000000000',
    ),
    company_name: String(addr?.company ?? ebayContact?.companyName ?? addr?.CompanyName ?? ''),
    address_line1: String(
      addr?.address1 ??
        addr?.addressLine1 ??
        addr?.AddressLine1 ??
        ssAddr?.street1 ??
        '1 Main St',
    ),
    address_line2: String(
      addr?.address2 ??
        addr?.addressLine2 ??
        addr?.AddressLine2 ??
        ssAddr?.street2 ??
        '',
    ) || null,
    city_locality: String(addr?.city ?? addr?.City ?? ssAddr?.city ?? 'Oakland'),
    state_province: String(
      addr?.state ??
        addr?.stateOrProvince ??
        addr?.StateOrRegion ??
        ssAddr?.state ??
        'CA',
    ),
    postal_code: postalCode || '94601',
    country_code: String(addr?.country ?? addr?.countryCode ?? addr?.CountryCode ?? ssAddr?.country ?? 'US'),
    address_residential_indicator: 'yes',
  };
}

export function shipEngineShipFrom(
  creds: Record<string, unknown>,
  input: { fromZip?: string; shipFrom?: any },
) {
  const shipFromInput = input.shipFrom && typeof input.shipFrom === 'object' ? input.shipFrom : {};
  const fromZip = String(
    creds?.shipFromZip ??
      shipFromInput?.postalCode ??
      input.fromZip ??
      '90248',
  ).replace(/[^0-9-]/g, '').slice(0, 10);
  return {
    name: String(creds?.shipFromName ?? shipFromInput?.name ?? 'Seller'),
    phone: String(creds?.shipFromPhone ?? shipFromInput?.phone ?? '0000000000'),
    company_name: String(creds?.shipFromCompany ?? creds?.shipFromName ?? shipFromInput?.name ?? ''),
    address_line1: String(
      creds?.shipFromAddress1 ??
        shipFromInput?.addressLine1 ??
        shipFromInput?.street1 ??
        'Warehouse',
    ),
    address_line2: String(
      creds?.shipFromAddress2 ??
        shipFromInput?.addressLine2 ??
        shipFromInput?.street2 ??
        '',
    ) || null,
    city_locality: String(creds?.shipFromCity ?? shipFromInput?.city ?? 'Carson'),
    state_province: String(creds?.shipFromState ?? shipFromInput?.state ?? 'CA'),
    postal_code: fromZip || '90248',
    country_code: String(shipFromInput?.country ?? 'US') || 'US',
    address_residential_indicator: 'no',
  };
}

export async function ratesFromShipEngine(
  creds: Record<string, unknown>,
  input: {
    weightOz: number;
    toZip?: string;
    fromZip?: string;
    dimsL?: number;
    dimsW?: number;
    dimsH?: number;
    shipFrom?: any;
    rawOrder?: any;
  },
): Promise<Array<{ service: string; cost: number; days: number; currency: string }>> {
  const apiKey = String(creds?.apiKey ?? '').trim();
  if (!apiKey) throw new Error('ShipEngine apiKey is required.');
  if (!input.dimsL || !input.dimsW || !input.dimsH) {
    throw new Error('ShipEngine rates require box dimensions (length, width, height).');
  }

  const carrierIds = await shipEngineCarrierIds(creds);
  if (!carrierIds.length) {
    throw new Error('ShipEngine has no connected carrier IDs available for rates.');
  }

  const body = {
    rate_options: {
      carrier_ids: carrierIds,
    },
    shipment: {
      validate_address: 'no_validation',
      ship_to: shipEngineShipTo(input.rawOrder, input.toZip),
      ship_from: shipEngineShipFrom(creds, {
        fromZip: input.fromZip,
        shipFrom: input.shipFrom,
      }),
      packages: [
        {
          weight: { value: Math.max(0.1, input.weightOz), unit: 'ounce' },
          dimensions: {
            unit: 'inch',
            length: input.dimsL,
            width: input.dimsW,
            height: input.dimsH,
          },
        },
      ],
    },
  };

  const res = await timedFetch('api.carriers.rates.external', 'https://api.shipengine.com/v1/rates', {
    method: 'POST',
    headers: {
      'API-Key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().then((s) => s.slice(0, 800)).catch(() => '');
    throw new Error(`ShipEngine rates ${res.status}: ${t || res.statusText}`);
  }

  const data = (await res.json()) as any;
  const response = data?.rate_response ?? data;
  const apiErrors = Array.isArray(response?.errors) ? response.errors : [];
  const rateList: any[] = Array.isArray(response?.rates) ? response.rates : [];
  if (!rateList.length && apiErrors.length) {
    throw new Error(`ShipEngine returned no rates: ${JSON.stringify(apiErrors).slice(0, 800)}`);
  }

  return rateList
    .map((rate: any) => {
      const shipping = Number(rate?.shipping_amount?.amount ?? 0);
      const insurance = Number(rate?.insurance_amount?.amount ?? 0);
      const confirmation = Number(rate?.confirmation_amount?.amount ?? 0);
      const other = Number(rate?.other_amount?.amount ?? 0);
      const cost = shipping + insurance + confirmation + other;
      const carrier = String(rate?.carrier_friendly_name ?? rate?.carrier_code ?? 'ShipEngine');
      const service = String(rate?.service_type ?? rate?.service_code ?? 'Rate');
      const currency = String(
        rate?.shipping_amount?.currency ??
          rate?.other_amount?.currency ??
          'USD',
      ).toUpperCase();
      const etaTime = Date.parse(rate?.estimated_delivery_date ?? '');
      const days = Number(rate?.delivery_days ?? 0) ||
        (Number.isFinite(etaTime)
          ? Math.max(1, Math.ceil((etaTime - Date.now()) / (24 * 60 * 60 * 1000)))
          : 0);
      return { service: `${carrier} ${service}`.trim(), cost, days, currency };
    })
    .filter((rate) => rate.cost > 0)
    .sort((a, b) => a.cost - b.cost);
}
