// @ts-nocheck
// Extracted verbatim from api/carriers/labels.ts (C2 decomposition). The
// direct-label endpoint handler dispatches here; behavior is unchanged.
import { timedFetch } from '../../../../src/lib/http/timing.js';

// ─── UPS access-token helper (mirrors the one in rates.ts; we duplicate
//     to keep this file self-contained — the function is short and the
//     duplication is preferable to factoring out a shared module).
async function getUpsAccessToken(creds: Record<string, unknown>): Promise<string> {
  const clientId = String(creds?.clientId ?? '').trim();
  const clientSecret = String(creds?.clientSecret ?? '').trim();
  if (!clientId || !clientSecret) throw new Error('UPS clientId + clientSecret required');
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await timedFetch('api.carriers.labels.external', 'https://onlinetools.ups.com/security/v1/oauth/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) {
    const t = await res.text().then((s) => s.slice(0, 200)).catch(() => '');
    throw new Error(`UPS OAuth ${res.status}: ${t || res.statusText}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data?.access_token) throw new Error('UPS OAuth response missing access_token');
  return data.access_token;
}

// ─── UPS label purchase via /api/shipments/v2403/ship ───────────────
// Returns: { trackingNumber, labelDataBase64, cost, currency }
// UPS returns the label as base64 GIF. For browser display we wrap it
// as a data: URL — Vercel function size limits prevent us from saving
// the bytes anywhere else without a separate object-store dependency.
export async function buyLabelUps(
  creds: Record<string, unknown>,
  input: {
    weightOz: number;
    dimsL: number; dimsW: number; dimsH: number;
    serviceCode: string; // e.g. "03" = Ground, "01" = Next Day Air
    shipFrom: any;
    shipTo: any;
  },
): Promise<{ trackingNumber: string; labelUrl: string; cost: number; currency: string; raw: any }> {
  const accountNumber = String(creds?.accountNumber ?? '').trim();
  if (!accountNumber) throw new Error('UPS accountNumber required');
  const token = await getUpsAccessToken(creds);

  const weightLb = Math.max(0.1, Math.round((input.weightOz / 16) * 10) / 10);

  const body = {
    ShipmentRequest: {
      Request: {
        SubVersion: '2403',
        RequestOption: 'nonvalidate',
        TransactionReference: { CustomerContext: 'prepship-label' },
      },
      Shipment: {
        Description: 'Merchandise',
        Shipper: {
          Name: input.shipFrom.name,
          AttentionName: input.shipFrom.name,
          ShipperNumber: accountNumber,
          Phone: { Number: input.shipFrom.phone || '0000000000' },
          Address: {
            AddressLine: [input.shipFrom.street1],
            City: input.shipFrom.city,
            StateProvinceCode: input.shipFrom.state,
            PostalCode: input.shipFrom.zip,
            CountryCode: input.shipFrom.country,
          },
        },
        ShipTo: {
          Name: input.shipTo.name,
          AttentionName: input.shipTo.name,
          Phone: { Number: input.shipTo.phone || '0000000000' },
          Address: {
            AddressLine: [input.shipTo.street1, input.shipTo.street2].filter(Boolean),
            City: input.shipTo.city,
            StateProvinceCode: input.shipTo.state,
            PostalCode: input.shipTo.zip,
            CountryCode: input.shipTo.country,
          },
        },
        ShipFrom: {
          Name: input.shipFrom.name,
          AttentionName: input.shipFrom.name,
          Phone: { Number: input.shipFrom.phone || '0000000000' },
          Address: {
            AddressLine: [input.shipFrom.street1],
            City: input.shipFrom.city,
            StateProvinceCode: input.shipFrom.state,
            PostalCode: input.shipFrom.zip,
            CountryCode: input.shipFrom.country,
          },
        },
        PaymentInformation: {
          ShipmentCharge: {
            Type: '01', // 01 = transportation charges
            BillShipper: { AccountNumber: accountNumber },
          },
        },
        Service: { Code: input.serviceCode },
        Package: {
          Description: 'Merchandise',
          Packaging: { Code: '02' }, // 02 = customer-supplied
          Dimensions: {
            UnitOfMeasurement: { Code: 'IN' },
            Length: String(input.dimsL),
            Width: String(input.dimsW),
            Height: String(input.dimsH),
          },
          PackageWeight: {
            UnitOfMeasurement: { Code: 'LBS' },
            Weight: String(weightLb),
          },
        },
      },
      LabelSpecification: {
        LabelImageFormat: { Code: 'GIF' },
        HTTPUserAgent: 'Mozilla/4.5',
      },
    },
  };

  const res = await timedFetch('api.carriers.labels.external', 'https://onlinetools.ups.com/api/shipments/v2403/ship', {
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
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* leave as text */ }
  if (!res.ok) {
    const errMsg = data?.response?.errors?.[0]?.message ?? text.slice(0, 600);
    throw new Error(`UPS Shipping ${res.status}: ${errMsg}`);
  }

  const shipResult = data?.ShipmentResponse?.ShipmentResults;
  const trackingNumber =
    shipResult?.PackageResults?.TrackingNumber ??
    shipResult?.PackageResults?.[0]?.TrackingNumber ??
    null;
  const labelImageBase64 =
    shipResult?.PackageResults?.ShippingLabel?.GraphicImage ??
    shipResult?.PackageResults?.[0]?.ShippingLabel?.GraphicImage ??
    null;
  const cost = Number(
    shipResult?.ShipmentCharges?.TotalCharges?.MonetaryValue ?? 0,
  );
  const currency = String(
    shipResult?.ShipmentCharges?.TotalCharges?.CurrencyCode ?? 'USD',
  );

  if (!trackingNumber) throw new Error('UPS Shipping response missing TrackingNumber');
  if (!labelImageBase64) throw new Error('UPS Shipping response missing label image');

  // Wrap the GIF base64 as a data URL so the FE can directly embed/print
  // without an extra fetch round-trip. UPS labels are ~30-50KB so this
  // stays well under any reasonable URL length limit for fetch responses.
  const labelUrl = `data:image/gif;base64,${labelImageBase64}`;

  return { trackingNumber, labelUrl, cost, currency, raw: data };
}
