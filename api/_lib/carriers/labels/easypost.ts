// @ts-nocheck
// Extracted verbatim from api/carriers/labels.ts (C2 decomposition). The
// direct-label endpoint handler dispatches here; behavior is unchanged.
import { timedFetch } from '../../../../src/lib/http/timing.js';

// ─── EasyPost label purchase: POST /shipments/{id}/buy ───────────────
// EasyPost uses a two-step flow: rate quote returns a shipment_id + rate
// objects with their own ids; buying selects which rate to commit. Since
// our /carriers/rates endpoint discards the EasyPost ids before
// returning, we re-quote here to get fresh ids, then buy. Costs nothing
// extra (rate quotes are free) and avoids stale-id failures.
export async function buyLabelEasyPost(
  creds: Record<string, unknown>,
  input: {
    weightOz: number;
    dimsL: number; dimsW: number; dimsH: number;
    serviceCode: string; // e.g. "USPS Priority" — we match on carrier+service
    shipFrom: any;
    shipTo: any;
  },
): Promise<{ trackingNumber: string; labelUrl: string; cost: number; currency: string; shipmentId: string; raw: any }> {
  const apiKey = String(creds?.apiKey ?? '').trim();
  if (!apiKey) throw new Error('EasyPost apiKey required');
  const basic = Buffer.from(`${apiKey}:`).toString('base64');
  const headers = {
    Authorization: `Basic ${basic}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  // Step 1: create shipment, get rate ids
  const shipBody = {
    shipment: {
      from_address: {
        name: input.shipFrom.name,
        street1: input.shipFrom.street1,
        city: input.shipFrom.city,
        state: input.shipFrom.state,
        zip: input.shipFrom.zip,
        country: input.shipFrom.country,
        phone: input.shipFrom.phone,
      },
      to_address: {
        name: input.shipTo.name,
        street1: input.shipTo.street1,
        street2: input.shipTo.street2 || '',
        city: input.shipTo.city,
        state: input.shipTo.state,
        zip: input.shipTo.zip,
        country: input.shipTo.country,
        phone: input.shipTo.phone,
      },
      parcel: {
        length: input.dimsL,
        width: input.dimsW,
        height: input.dimsH,
        weight: input.weightOz,
      },
    },
  };
  const createRes = await timedFetch('api.carriers.labels.external', 'https://api.easypost.com/v2/shipments', {
    method: 'POST', headers, body: JSON.stringify(shipBody),
  });
  if (!createRes.ok) {
    const t = await createRes.text().then((s) => s.slice(0, 600)).catch(() => '');
    throw new Error(`EasyPost create-shipment ${createRes.status}: ${t}`);
  }
  const shipment = (await createRes.json()) as any;

  // Step 2: pick the rate matching serviceCode (or cheapest if no match)
  const rates: any[] = Array.isArray(shipment?.rates) ? shipment.rates : [];
  if (rates.length === 0) throw new Error('EasyPost shipment has no rates — check carrier connections in EasyPost dashboard');
  const wantSvc = String(input.serviceCode ?? '').toLowerCase();
  let rate =
    rates.find((r) => `${r.carrier} ${r.service}`.toLowerCase() === wantSvc) ??
    rates.find((r) => String(r.service).toLowerCase() === wantSvc) ??
    rates.find((r) => `${r.carrier}_${r.service}`.toLowerCase() === wantSvc.replace(/\s+/g, '_'));
  if (!rate) {
    // Fallback: pick the cheapest. The user gets *some* label rather than
    // a hard failure, and the response includes which service was actually
    // used so they can adjust if needed.
    rate = rates.reduce((cheapest: any, r: any) =>
      Number(r.rate) < Number(cheapest.rate) ? r : cheapest,
    rates[0]);
  }

  // Step 3: buy the chosen rate
  const buyRes = await timedFetch('api.carriers.labels.external', `https://api.easypost.com/v2/shipments/${shipment.id}/buy`, {
    method: 'POST', headers, body: JSON.stringify({ rate: { id: rate.id } }),
  });
  if (!buyRes.ok) {
    const t = await buyRes.text().then((s) => s.slice(0, 600)).catch(() => '');
    throw new Error(`EasyPost buy-shipment ${buyRes.status}: ${t}`);
  }
  const purchased = (await buyRes.json()) as any;

  return {
    trackingNumber: String(purchased.tracking_code ?? ''),
    labelUrl: String(purchased.postage_label?.label_url ?? ''),
    cost: Number(purchased.selected_rate?.rate ?? rate.rate ?? 0),
    currency: String(purchased.selected_rate?.currency ?? rate.currency ?? 'USD'),
    shipmentId: String(purchased.id ?? shipment.id),
    raw: purchased,
  };
}
