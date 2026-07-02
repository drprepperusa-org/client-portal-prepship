import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { shipments } from '../db/schema/shipments';
import { ssRequest } from '../lib/shipstation/client';

// ── Carrier nickname resolver ─────────────────────────────────────────────────
// Ported from v2's apps/api/src/modules/orders/application/carrier-resolver.ts.
// v2 resolves against a hardcoded CARRIER_ACCOUNTS_V2 map. v4 doesn't have that
// map — we resolve against:
//   1. shipments.providerAccountNickname (set when PrepShip creates the label)
//   2. ShipStation's dynamic /v2/carriers response (providerAccountId match,
//      UPS 1Z tracking decode, single-carrier fallback)
//   3. Human-readable fallback from CARRIER_DISPLAY_NAMES below.

import type { Carrier, CarriersResponse } from '../lib/shipstation/types';

const CARRIER_DISPLAY_NAMES: Record<string, string> = {
  stamps_com: 'USPS',
  ups: 'UPS',
  ups_walleted: 'UPS',
  fedex: 'FedEx',
  fedex_walleted: 'FedEx One Balance',
  dhl_express: 'DHL Express',
  amazon_buy_shipping: 'Amazon',
  amazon_shipping_us: 'Amazon',
  sendle: 'Sendle',
  tusk: 'Tusk',
};

// In-process TTL cache for /v2/carriers — ShipStation rate limits and the
// list rarely changes. 5 minute TTL is plenty for nickname resolution.
const CARRIERS_CACHE_TTL_MS = 5 * 60 * 1000;
let carriersCache: { at: number; data: Carrier[] } | null = null;

async function loadCarriersList(): Promise<Carrier[]> {
  const now = Date.now();
  if (carriersCache && now - carriersCache.at < CARRIERS_CACHE_TTL_MS) {
    return carriersCache.data;
  }
  try {
    const res = await ssRequest<CarriersResponse>('/v2/carriers', {
      dedupeKey: 'carriers:list',
    });
    carriersCache = { at: now, data: res.carriers };
    return res.carriers;
  } catch {
    // Stale cache > no data: if SS is down, keep returning what we had.
    return carriersCache?.data ?? [];
  }
}

function carrierIdToProviderAccountId(carrierId: string | null | undefined): number | null {
  if (!carrierId) return null;
  const num = Number(String(carrierId).replace(/^se-/, ''));
  return Number.isFinite(num) ? num : null;
}

/**
 * Resolve a human-readable carrier label (e.g. "ORION", "USPS Chase x7439")
 * for a shipment. Mirrors v2's resolveCarrierNickname() resolution order:
 *
 *   1. providerAccountId exact match — first against any DB-persisted
 *      shipments.providerAccountNickname for this account, then against
 *      ShipStation's /v2/carriers response.
 *   2. UPS 1Z tracking decode: chars 3-8 = UPS account code → match
 *      Carrier.account_number.
 *   3. Only one carrier for carrierCode → use that carrier's nickname.
 *   4. Human-readable fallback from CARRIER_DISPLAY_NAMES.
 *
 * The clientId arg is accepted for v2 signature parity — v4 has no client-
 * scoped carrier accounts in the dynamic SS list, so it's currently unused
 * beyond logging context.
 */
export async function resolveCarrierNickname(
  providerAccountId: number | null,
  carrierCode: string | null,
  trackingNumber?: string | null,
  _clientId?: number | null,
): Promise<string | null> {
  if (!carrierCode) return null;

  // 1a. DB-persisted per-shipment nickname (set when PrepShip creates the label)
  if (providerAccountId) {
    try {
      const [row] = await db
        .select({ nickname: shipments.providerAccountNickname })
        .from(shipments)
        .where(eq(shipments.providerAccountId, providerAccountId))
        .limit(1);
      if (row?.nickname) return row.nickname;
    } catch {
      // non-fatal; fall through to SS-dynamic resolution
    }
  }

  const carriers = await loadCarriersList();

  // 1b. Exact match by providerAccountId against SS's carriers list
  if (providerAccountId) {
    const exact = carriers.find((c) => carrierIdToProviderAccountId(c.carrier_id) === providerAccountId);
    if (exact) return exact.nickname || exact.friendly_name || exact.carrier_code;
  }

  // 2. UPS: decode account code from tracking number
  //    Format: 1Z [acct:6] [service:2] [seq:8] [check:1]
  if ((carrierCode === 'ups' || carrierCode === 'ups_walleted') && trackingNumber) {
    const tn = trackingNumber.replace(/\s/g, '').toUpperCase();
    if (tn.startsWith('1Z') && tn.length >= 8) {
      const acctCode = tn.slice(2, 8);
      const matched = carriers.find(
        (c) =>
          (c.carrier_code === 'ups' || c.carrier_code === 'ups_walleted') &&
          c.account_number?.toUpperCase() === acctCode,
      );
      if (matched) return matched.nickname || matched.friendly_name || matched.carrier_code;
    }
  }

  // 3. Single-match fallback by carrierCode
  const matching = carriers.filter((c) => c.carrier_code === carrierCode);
  if (matching.length === 1) {
    const m = matching[0]!;
    return m.nickname || m.friendly_name || m.carrier_code;
  }

  // 4. Human-readable fallback
  return CARRIER_DISPLAY_NAMES[carrierCode] ?? carrierCode.replace(/_/g, ' ').toUpperCase();
}
