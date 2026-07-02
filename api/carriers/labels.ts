// @ts-nocheck
// Vercel serverless function: purchase a shipping label via the carrier
// the user picked in Rate Browser. Closes the rate-quote loop end-to-end —
// before this endpoint, our direct integrations could ONLY get rates;
// actually buying the label still required ShipStation. With this in
// place, PrepShip can ship orders without ShipStation in the loop.
//
// Auth: Supabase JWT in Authorization: Bearer <token>.
//
// POST body:
//   {
//     carrierAccountId: number,            // saved carrier_accounts row id
//     externalOrderId?: string,            // e.g. "walmart-12345" — for ship-to + items
//     rateId?: string,                     // EasyPost-only: which of the rates to buy
//     serviceCode?: string,                // UPS/USPS/etc: pick a specific service
//     weightOz: number,
//     dimsL: number, dimsW: number, dimsH: number,
//     // Optional explicit ship-to override (useful when externalOrderId
//     // isn't a marketplace pull):
//     shipTo?: { name, street1, street2?, city, state, zip, country, phone? }
//   }
//
// Response (success):
//   { ok: true, provider, trackingNumber, labelUrl, labelFormat: 'PDF',
//     cost: number, currency: 'USD', shipmentId?: string }
// Response (failure):
//   { ok: false, error: string, meta?: ... }

import { createRemoteJWKSet, jwtVerify } from 'jose';
import postgres from 'postgres';
import { persistDirectCarrierLabel } from '../../src/services/direct-label-persistence.js';
import { SHIPP_PROVIDER_ID_OFFSET, normalizeProviderKey } from '../_lib/carriers/labels/shared.js';
import { inferStoreProviderFromExternalId, sourceOrderIdFromExternalId, enqueueShipmentConfirmationSql } from '../_lib/carriers/labels/outbox.js';
import { resolveShipTo, resolveShipFrom } from '../_lib/carriers/labels/address.js';
import { buyLabelUps } from '../_lib/carriers/labels/ups.js';
import { buyLabelEasyPost } from '../_lib/carriers/labels/easypost.js';
import { buyLabelWalmartShipping, persistWalmartShipment, confirmWalmartSourceOrderAfterLabelSql, markWalmartConfirmationAttemptSql, walmartTrackingUrl } from '../_lib/carriers/labels/walmart.js';
import { buyLabelShipp, persistShippShipment } from '../_lib/carriers/labels/shipp.js';

// Re-exported so scripts/direct-carrier-label-guard.mjs can tsImport the
// endpoint module and exercise the walmart extraction/lookup logic.
export { __test_extractWalmartLabelReference, __test_selectWalmartOrderByCustomerOrderId } from '../_lib/carriers/labels/walmart.js';

let cachedJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  if (cachedJwks) return cachedJwks;
  const base = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
  if (!base) return null;
  cachedJwks = createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`));
  return cachedJwks;
}

async function verifySupabaseJwt(token: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const errors: string[] = [];
  const jwks = getJwks();
  if (jwks) {
    try { await jwtVerify(token, jwks); return { ok: true }; }
    catch (err) { errors.push(`JWKS: ${err instanceof Error ? err.message : String(err)}`); }
  }
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (secret) {
    try { await jwtVerify(token, new TextEncoder().encode(secret)); return { ok: true }; }
    catch (err) { errors.push(`HS256: ${err instanceof Error ? err.message : String(err)}`); }
  }
  return { ok: false, reason: errors.join(' | ') || 'no verification method' };
}

const LABEL_CREATE_CONNECTOR_CAPABILITIES: Record<string, string[]> = {
  shipp: ['rates.quote', 'labels.create', 'tracking.read', 'credentials.verify'],
  walmart_shipping: ['rates.quote', 'labels.create', 'labels.void', 'tracking.read', 'credentials.verify'],
  ups: ['rates.quote', 'labels.create', 'labels.void', 'tracking.read', 'credentials.verify'],
  easypost: ['rates.quote', 'labels.create', 'labels.void', 'tracking.read', 'credentials.verify', 'webhooks.receive'],
};

function labelCreateConnectorCapabilities(providerKey: string): string[] | null {
  return LABEL_CREATE_CONNECTOR_CAPABILITIES[providerKey] ?? null;
}

function readBody(req: any): Promise<unknown> {
  if (req.body) {
    if (typeof req.body === 'object') return Promise.resolve(req.body);
    if (typeof req.body === 'string') {
      try { return Promise.resolve(JSON.parse(req.body)); } catch { return Promise.resolve({}); }
    }
  }
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

export default async function handler(req: any, res: any): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }

  const auth = (req.headers?.authorization || req.headers?.Authorization || '') as string;
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) { res.status(401).json({ error: 'Missing Authorization' }); return; }
  const verified = await verifySupabaseJwt(token);
  if (!verified.ok) { res.status(401).json({ error: 'Invalid token', reason: verified.reason }); return; }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { res.status(500).json({ error: 'DATABASE_URL not configured' }); return; }
  const sql = postgres(dbUrl, { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 5 });

  try {
    const body = (await readBody(req)) as Record<string, any>;
    const carrierAccountId = Number(body?.carrierAccountId);
    if (!Number.isFinite(carrierAccountId)) {
      res.status(400).json({ error: 'carrierAccountId is required' });
      return;
    }
    const weightOz = Number(body?.weightOz);
    const dimsL = Number(body?.dimsL);
    const dimsW = Number(body?.dimsW);
    const dimsH = Number(body?.dimsH);
    if (!weightOz || !dimsL || !dimsW || !dimsH) {
      res.status(400).json({ error: 'weightOz + dimsL/W/H are required' });
      return;
    }

    const carrierRows = await sql<Array<{ provider: string; credentials: any; label: string | null }>>`
      SELECT provider, credentials, label FROM carrier_accounts
      WHERE id = ${carrierAccountId} LIMIT 1
    `;
    if (carrierRows.length === 0) {
      res.status(404).json({ error: `carrier_account ${carrierAccountId} not found` });
      return;
    }
    const { provider, credentials, label } = carrierRows[0];
    const providerKey = normalizeProviderKey(provider);
    const connectorCapabilities = labelCreateConnectorCapabilities(providerKey);
    if (!connectorCapabilities) {
      res.status(400).json({
        ok: false,
        error: `Label purchase for "${provider}" is not registered as a carrier connector.`,
      });
      return;
    }
    const creds = (credentials ?? {}) as Record<string, unknown>;

    // Fetch the saved order's raw payload to derive ship-to (when caller
    // didn't pass an explicit shipTo override).
    let rawOrder: any = null;
    let orderRow: any = null;
    let orderLookupError: string | null = null;
    const orderId = Number(body?.orderId);
    if (Number.isFinite(orderId) && orderId > 0) {
      try {
        const rows = await sql<Array<{
          id: number;
          client_id: number | null;
          order_number: string | null;
          external_order_id: string | null;
          order_status: string | null;
          raw: any;
        }>>`
          SELECT id, client_id, order_number, external_order_id, order_status, raw
          FROM orders
          WHERE id = ${Math.trunc(orderId)}
          LIMIT 1
        `;
        orderRow = rows[0] ?? null;
        rawOrder = orderRow?.raw ?? null;
      } catch (err) {
        orderLookupError = err instanceof Error ? err.message : String(err);
      }
    }

    const explicitExternalOrderId = typeof body?.externalOrderId === 'string'
      ? body.externalOrderId
      : null;
    const externalOrderId = explicitExternalOrderId ?? orderRow?.external_order_id ?? null;
    const orderNumber = typeof body?.orderNumber === 'string'
      ? body.orderNumber
      : orderRow?.order_number ?? null;
    if (externalOrderId) {
      const m = externalOrderId.match(/^([a-z_]+)-(.+)$/);
      if (m) {
        try {
          const rows = await sql<Array<{ raw: any }>>`
            SELECT raw FROM store_orders
            WHERE provider = ${m[1]} AND external_order_id = ${m[2]}
            LIMIT 1
          `;
          rawOrder = rows[0]?.raw ?? rawOrder;
        } catch { /* non-fatal */ }
      }
    }

    if (providerKey === 'shipp') {
      if (!Number.isFinite(orderId) || orderId <= 0) {
        res.status(400).json({ ok: false, error: 'orderId is required for Shipp label creation' });
        return;
      }
      if (orderLookupError) {
        throw new Error(`Could not load order before buying Shipp label: ${orderLookupError}`);
      }
      if (!orderRow) {
        res.status(404).json({ ok: false, error: `Order ${Math.trunc(orderId)} not found` });
        return;
      }
      if (orderRow.order_status === 'shipped' || orderRow.order_status === 'cancelled') {
        res.status(409).json({ ok: false, error: `Cannot create Shipp label for ${orderRow.order_status} order` });
        return;
      }

      const serviceCode = String(body?.serviceCode ?? '').trim();
      if (!serviceCode) {
        res.status(400).json({ ok: false, error: 'serviceCode is required for Shipp label creation' });
        return;
      }

      const syntheticProviderId = Number.isFinite(Number(body?.shippingProviderId))
        ? Number(body.shippingProviderId)
        : SHIPP_PROVIDER_ID_OFFSET + carrierAccountId;
      const result = await buyLabelShipp(creds, {
        serviceCode,
        weightOz,
        dimsL,
        dimsW,
        dimsH,
        shipFrom: body?.shipFrom,
        shipTo: body?.shipTo,
        rawOrder,
        externalOrderId,
        orderNumber,
      });
      const persisted = await persistShippShipment(sql, {
        body,
        provider: providerKey,
        carrierAccountId,
        syntheticProviderId,
        carrierLabel: label,
        result,
      });
      const confirmation = await enqueueShipmentConfirmationSql(sql, {
        orderId,
        shipmentId: persisted.localShipmentId,
        externalOrderId,
        clientId: persisted.clientId,
        orderNumber: persisted.orderNumber,
        trackingNumber: result.trackingNumber,
        carrierCode: result.carrierCode,
        carrierProvider: 'shipp',
        carrierAccountId,
        shipDate: new Date().toISOString().slice(0, 10),
        payload: {
          purchaseOrderId: sourceOrderIdFromExternalId(externalOrderId),
          rawOrder,
          carrierName: result.carrierName ?? result.carrierCode,
          trackingUrl: null,
          serviceCode: result.serviceCode,
          serviceName: result.serviceName,
        },
      }).catch((err) => {
        console.warn('[carriers/labels] confirmation outbox enqueue failed:', err instanceof Error ? err.message : err);
        return { queued: false, provider: inferStoreProviderFromExternalId(externalOrderId), error: err instanceof Error ? err.message : String(err) };
      });

      let marketplaceShipmentConfirmed: boolean | null = null;
      let marketplaceShipmentConfirmError: string | null = null;
      let marketplaceCredentialSource: string | null = null;
      let marketplaceStoreAccountId: number | null = null;
      if (confirmation.provider === 'walmart') {
        try {
          const confirmed = await confirmWalmartSourceOrderAfterLabelSql(sql, {
            orderId,
            shipmentId: persisted.localShipmentId,
            purchaseOrderId: sourceOrderIdFromExternalId(externalOrderId),
            rawOrder,
            carrierName: result.carrierName ?? result.carrierCode ?? 'Other',
            trackingNumber: result.trackingNumber,
            trackingUrl: walmartTrackingUrl(result.carrierName ?? result.carrierCode ?? '', result.trackingNumber),
            shipDate: new Date().toISOString().slice(0, 10),
            fallbackCreds: {},
          });
          marketplaceShipmentConfirmed = confirmed.confirmed;
          marketplaceShipmentConfirmError = confirmed.error;
          marketplaceCredentialSource = confirmed.credentialSource;
          marketplaceStoreAccountId = confirmed.storeAccountId;
        } catch (err) {
          marketplaceShipmentConfirmed = false;
          marketplaceShipmentConfirmError = err instanceof Error ? err.message : String(err);
          console.warn('[carriers/labels] walmart source confirmation after Shipp label failed:', marketplaceShipmentConfirmError);
          await markWalmartConfirmationAttemptSql(sql, {
            orderId,
            shipmentId: persisted.localShipmentId,
            provider: 'walmart',
            succeeded: false,
            error: marketplaceShipmentConfirmError,
          }).catch((markErr) => {
            console.warn('[carriers/labels] walmart source confirmation status update failed:', markErr instanceof Error ? markErr.message : markErr);
          });
        }
      }

      res.status(200).json({
        ok: true,
        provider: providerKey,
        carrierLabel: label,
        trackingNumber: result.trackingNumber,
        labelUrl: result.labelUrl,
        labelFormat: result.labelUrl?.startsWith('data:application/pdf') ? 'PDF' : 'IMAGE',
        cost: result.cost,
        currency: result.currency,
        shipmentId: persisted.localShipmentId,
        localShipmentId: persisted.localShipmentId,
        orderStatus: 'shipped',
        apiVersion: 'shipp',
        voided: false,
        meta: {
          externalOrderId,
          orderNumber,
          hasRawOrder: rawOrder != null,
          carrierAccountId,
          confirmationQueued: confirmation.queued,
          confirmationProvider: confirmation.provider,
          confirmationError: confirmation.error ?? null,
          marketplaceShipmentConfirmed,
          marketplaceShipmentConfirmError,
          marketplaceStoreAccountId,
          marketplaceCredentialSource,
          shippShipmentId: result.shipmentId,
          selectedServiceCode: result.serviceCode,
          connectorCapabilities,
        },
      });
      return;
    }

    if (providerKey === 'walmart_shipping') {
      if (!Number.isFinite(orderId) || orderId <= 0) {
        res.status(400).json({ ok: false, error: 'orderId is required for Walmart Shipping label creation' });
        return;
      }
      if (orderLookupError) {
        throw new Error(`Could not load order before buying Walmart Shipping label: ${orderLookupError}`);
      }
      if (!orderRow) {
        res.status(404).json({ ok: false, error: `Order ${Math.trunc(orderId)} not found` });
        return;
      }
      if (orderRow.order_status === 'shipped' || orderRow.order_status === 'cancelled') {
        res.status(409).json({ ok: false, error: `Cannot create Walmart Shipping label for ${orderRow.order_status} order` });
        return;
      }

      const syntheticProviderId = Number.isFinite(Number(body?.shippingProviderId))
        ? Number(body.shippingProviderId)
        : SHIPP_PROVIDER_ID_OFFSET + carrierAccountId;
      const result = await buyLabelWalmartShipping(sql, creds, {
        body,
        orderRow,
        rawOrder,
        weightOz,
        dimsL,
        dimsW,
        dimsH,
      });
      const persisted = await persistWalmartShipment(sql, {
        body,
        provider: providerKey,
        carrierAccountId,
        syntheticProviderId,
        carrierLabel: label,
        result,
      });
      const confirmation = await enqueueShipmentConfirmationSql(sql, {
        orderId,
        shipmentId: persisted.localShipmentId,
        externalOrderId: result.context.externalOrderId,
        clientId: persisted.clientId,
        orderNumber: persisted.orderNumber,
        trackingNumber: result.trackingNumber,
        carrierCode: result.carrierCode,
        carrierProvider: 'walmart_shipping',
        carrierAccountId,
        confirmationProvider: 'walmart',
        shipDate: new Date().toISOString().slice(0, 10),
        payload: {
          storeAccountId: result.context.storeAccountId ?? undefined,
          purchaseOrderId: result.context.purchaseOrderId,
          rawOrder: result.context.rawOrder,
          carrierName: result.carrierName,
          trackingUrl: walmartTrackingUrl(result.carrierName, result.trackingNumber),
          serviceCode: result.serviceCode,
          serviceName: result.serviceName,
        },
      }).catch((err) => {
        console.warn('[carriers/labels] walmart confirmation outbox enqueue failed:', err instanceof Error ? err.message : err);
        return { queued: false, provider: 'walmart', error: err instanceof Error ? err.message : String(err) };
      });

      let walmartConfirmationCredentialSource: string | null = null;
      let walmartConfirmationStoreAccountId: number | null = result.context.storeAccountId ?? null;
      try {
        const confirmed = await confirmWalmartSourceOrderAfterLabelSql(sql, {
          orderId,
          shipmentId: persisted.localShipmentId,
          purchaseOrderId: result.context.purchaseOrderId,
          rawOrder: result.context.rawOrder,
          carrierName: result.carrierName,
          trackingNumber: result.trackingNumber,
          trackingUrl: walmartTrackingUrl(result.carrierName, result.trackingNumber),
          shipDate: new Date().toISOString().slice(0, 10),
          storeAccountId: result.context.storeAccountId,
          fallbackCreds: creds,
        });
        result.shipmentConfirmRaw = confirmed.raw;
        result.shipmentConfirmed = confirmed.confirmed;
        result.shipmentConfirmError = confirmed.error;
        walmartConfirmationCredentialSource = confirmed.credentialSource;
        walmartConfirmationStoreAccountId = confirmed.storeAccountId;
      } catch (err) {
        result.shipmentConfirmed = false;
        result.shipmentConfirmError = err instanceof Error ? err.message : String(err);
        console.warn('[carriers/labels] walmart immediate confirmation failed:', result.shipmentConfirmError);
        await markWalmartConfirmationAttemptSql(sql, {
          orderId,
          shipmentId: persisted.localShipmentId,
          provider: 'walmart',
          succeeded: false,
          error: result.shipmentConfirmError,
        }).catch((markErr) => {
          console.warn('[carriers/labels] walmart confirmation status update failed:', markErr instanceof Error ? markErr.message : markErr);
        });
      }

      res.status(200).json({
        ok: true,
        provider: providerKey,
        carrierLabel: label,
        trackingNumber: result.trackingNumber,
        labelUrl: result.labelUrl,
        labelFormat: result.labelUrl?.startsWith('data:application/pdf') ? 'PDF' : null,
        cost: result.cost,
        currency: result.currency,
        shipmentId: persisted.localShipmentId,
        localShipmentId: persisted.localShipmentId,
        orderStatus: persisted.orderStatus,
        apiVersion: 'walmart_shipping',
        voided: false,
        meta: {
          externalOrderId: result.context.externalOrderId,
          orderNumber: result.context.orderNumber,
          purchaseOrderId: result.context.purchaseOrderId,
          purchaseOrderSource: result.context.purchaseOrderSource,
          marketplaceStoreAccountId: walmartConfirmationStoreAccountId,
          marketplaceCredentialSource: walmartConfirmationCredentialSource,
          hasRawOrder: result.context.rawOrder != null,
          carrierAccountId,
          confirmationQueued: confirmation.queued,
          confirmationProvider: confirmation.provider,
          confirmationError: confirmation.error ?? null,
          selectedServiceCode: result.serviceCode,
          walmartTrackingNumber: result.trackingNumber,
          labelPdfReturned: Boolean(result.labelUrl),
          walmartShipmentConfirmed: result.shipmentConfirmed,
          walmartShipmentConfirmError: result.shipmentConfirmError,
          connectorCapabilities,
        },
      });
      return;
    }

    const shipTo = resolveShipTo(body, rawOrder);
    const shipFrom = resolveShipFrom(creds);

    let result: any = null;
    let directServiceCode: string | null = null;
    if (providerKey === 'ups') {
      if (!Number.isFinite(orderId) || orderId <= 0) {
        res.status(400).json({ ok: false, error: 'orderId is required for UPS label creation' });
        return;
      }
      if (orderLookupError) {
        throw new Error(`Could not load order before buying UPS label: ${orderLookupError}`);
      }
      if (!orderRow) {
        res.status(404).json({ ok: false, error: `Order ${Math.trunc(orderId)} not found` });
        return;
      }
      if (orderRow.order_status === 'shipped' || orderRow.order_status === 'cancelled') {
        res.status(409).json({ ok: false, error: `Cannot create UPS label for ${orderRow.order_status} order` });
        return;
      }
      // UPS service code default: "03" = Ground. Caller can pass
      // serviceCode like "01" (Next Day Air), "02" (2nd Day Air), etc.
      directServiceCode = String(body?.serviceCode ?? '03');
      result = await buyLabelUps(creds, {
        weightOz, dimsL, dimsW, dimsH, serviceCode: directServiceCode, shipFrom, shipTo,
      });
    } else if (providerKey === 'easypost') {
      if (!Number.isFinite(orderId) || orderId <= 0) {
        res.status(400).json({ ok: false, error: 'orderId is required for EasyPost label creation' });
        return;
      }
      if (orderLookupError) {
        throw new Error(`Could not load order before buying EasyPost label: ${orderLookupError}`);
      }
      if (!orderRow) {
        res.status(404).json({ ok: false, error: `Order ${Math.trunc(orderId)} not found` });
        return;
      }
      if (orderRow.order_status === 'shipped' || orderRow.order_status === 'cancelled') {
        res.status(409).json({ ok: false, error: `Cannot create EasyPost label for ${orderRow.order_status} order` });
        return;
      }
      directServiceCode = String(body?.serviceCode ?? 'USPS Priority');
      result = await buyLabelEasyPost(creds, {
        weightOz, dimsL, dimsW, dimsH, serviceCode: directServiceCode, shipFrom, shipTo,
      });
    } else {
      res.status(400).json({
        error: `Label purchase for "${provider}" is not implemented yet. Currently supported: ups, easypost, shipp.`,
      });
      return;
    }

    const selectedRateJson = {
      carrierCode: providerKey,
      serviceCode: directServiceCode,
      serviceName: directServiceCode,
      carrierNickname: label ?? providerKey,
      providerAccountNickname: label ?? providerKey,
      providerAccountId: carrierAccountId,
      shippingProviderId: carrierAccountId,
      provider: providerKey,
      source: 'carrier_accounts',
      amount: result.cost,
      cost: result.cost,
      shipmentCost: result.cost,
      otherCost: 0,
      raw: result.raw,
    };
    const persisted = await persistDirectCarrierLabel(sql, {
      orderId,
      carrierProvider: providerKey === 'ups' ? 'UPS' : 'EasyPost',
      carrierAccountId,
      carrierLabel: label ?? providerKey,
      carrierCode: providerKey,
      serviceCode: directServiceCode,
      trackingNumber: result.trackingNumber,
      labelUrl: result.labelUrl,
      labelFormat: providerKey === 'ups' ? 'gif' : 'pdf',
      cost: result.cost,
      currency: result.currency,
      weightOz,
      dimsL,
      dimsW,
      dimsH,
      selectedRateJson,
      labelProvider: carrierAccountId,
      labelShipmentId: null,
      selectedPid: carrierAccountId,
      selectedPackageId: body?.customPackageId != null ? String(body.customPackageId) : null,
      source: providerKey,
    });
    const confirmation = await enqueueShipmentConfirmationSql(sql, {
      orderId,
      shipmentId: persisted.localShipmentId,
      externalOrderId,
      clientId: persisted.clientId,
      orderNumber: persisted.orderNumber,
      trackingNumber: result.trackingNumber,
      carrierCode: providerKey,
      carrierProvider: providerKey,
      carrierAccountId,
      shipDate: new Date().toISOString().slice(0, 10),
      payload: {
        purchaseOrderId: sourceOrderIdFromExternalId(externalOrderId),
        rawOrder,
        carrierName: providerKey === 'ups' ? 'UPS' : 'EasyPost',
        trackingUrl: null,
        serviceCode: directServiceCode,
      },
    }).catch((err) => {
      console.warn('[carriers/labels] confirmation outbox enqueue failed:', err instanceof Error ? err.message : err);
      return { queued: false, provider: inferStoreProviderFromExternalId(externalOrderId), error: err instanceof Error ? err.message : String(err) };
    });

    res.status(200).json({
      ok: true,
      provider,
      carrierLabel: label,
      trackingNumber: result.trackingNumber,
      labelUrl: result.labelUrl,
      labelFormat: provider === 'ups' ? 'GIF' : 'PDF',
      cost: result.cost,
      currency: result.currency,
      shipmentId: persisted.localShipmentId,
      localShipmentId: persisted.localShipmentId,
      orderStatus: persisted.orderStatus,
      meta: {
        externalOrderId,
        hasRawOrder: rawOrder != null,
        carrierAccountId,
        carrierShipmentId: result.shipmentId ?? null,
        confirmationQueued: confirmation.queued,
        confirmationProvider: confirmation.provider,
        confirmationError: confirmation.error ?? null,
        connectorCapabilities,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[carriers/labels]', msg);
    res.status(500).json({ ok: false, error: msg });
  } finally {
    try { await sql.end({ timeout: 1 }); } catch { /* ignore */ }
  }
}
