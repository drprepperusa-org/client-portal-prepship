/**
 * CP-059 — the server-only boundary between the Client Portal and PrepShip's canonical
 * billing event rows.
 *
 * WHY THIS EXISTS
 *
 * PrepShip owns billing-event row grain, Outbound-vs-Return identity, `displayReference`,
 * destination classification, fee-presence semantics, and every billing amount. It issues
 * them from `billingDetails() -> toBillingDetailOrderRows()` over authenticated
 * `GET /billing/details`.
 *
 * The portal previously built its own rows in SQL, grouping by
 * `b.client_id, c.name, b.order_id, b.order_number`. That grouping is a SECOND owner of row
 * grain: it collapses an outbound event and every return on the same order into ONE row, and
 * coalesces an absent return amount to zero. Both are decisions PrepShip has already made
 * differently, so the portal was not rendering canonical truth — it was re-deriving a
 * competing version of it.
 *
 * This module forwards the caller's own authenticated, scoped read intent and validates what
 * comes back. It does NOT re-authorize: PrepShip re-authorizes scope against the same bearer,
 * which is why the token is forwarded rather than exchanged for a service credential.
 *
 * WHAT THIS MODULE MUST NEVER DO
 *
 * No country or territory comparison. No suffix or reference minting. No description parsing.
 * No null-to-zero coercion for fee presence. No arithmetic on money. No passing the upstream
 * object through unfiltered. Each of those would recreate the second owner this replaces.
 */
import { env } from '../env.js';

/** Exactly the values PrepShip's `BillingRowType` can take. Not widened locally. */
export type CanonicalBillingRowType = 'Outbound' | 'Return';

/** Exactly the values PrepShip's `BillingDestination` can take. Not widened locally. */
export type CanonicalBillingDestination = 'Domestic' | 'International' | 'Needs Review';

/**
 * The customer-safe allowlist. Anything PrepShip sends that is not named here is DISCARDED
 * before the row can reach a browser, a print surface or an export.
 *
 * Allowlist rather than denylist on purpose: a denylist has to predict every internal field
 * an upstream might add later, and it silently fails open the first time it guesses wrong.
 */
export interface CanonicalBillingEventRow {
  // Identity — relational, issued upstream.
  clientId: number | null;
  clientName: string | null;
  orderId: number | null;
  orderNumber: string | null;
  /** Relational return identity. Null on an outbound row. NEVER derived from a display string. */
  returnId: number | string | null;
  /** 'Outbound' | 'Return', decided upstream. */
  rowType: CanonicalBillingRowType | null;
  /** e.g. "1234", "1234-RETURN", "1234-RETURN-2". A LABEL, never a key. */
  displayReference: string | null;
  /** 'Domestic' | 'International' | 'Needs Review', decided upstream. */
  destination: CanonicalBillingDestination | null;

  // Fee presence — distinct from amount. A missing line is not a zero line.
  hasReturnPostageLine: boolean | null;
  hasReturnProcessingLine: boolean | null;

  // Money — rendered verbatim, never summed or defaulted here.
  pickpackTotal: number | null;
  additionalTotal: number | null;
  packageTotal: number | null;
  shippingTotal: number | null;
  storageTotal: number | null;
  adjustmentTotal: number | null;
  returnPostageTotal: number | null;
  returnProcessingTotal: number | null;
  returnTotal: number | null;
  grandTotal: number | null;

  // Dates and presentation-safe descriptors.
  shipDate: string | null;
  actualActivityDate: string | null;
  billingEffectiveDate: string | null;
  billingPolicyVersion: string | null;
  rolledFromWeekend: boolean | null;
  recipientName: string | null;
  boxSize: string | null;
  displayQty: string | null;
  qty: number | string | null;
}

/** Field names copied verbatim when present. Order is the contract; do not reorder casually. */
const ALLOWED_STRING_FIELDS = [
  'clientName', 'orderNumber', 'displayReference', 'shipDate', 'actualActivityDate',
  'billingEffectiveDate', 'billingPolicyVersion', 'recipientName', 'boxSize', 'displayQty',
] as const;

/**
 * The money fields PrepShip declares `: number` (never optional) on BillingDetailRowDto.
 * Derived from the producer's own type declarations — not from this repository's contract file,
 * whose fields are all optional, and not from an assumption about what "should" be present.
 */
const REQUIRED_NUMBER_FIELDS = [
  'pickpackTotal', 'additionalTotal', 'packageTotal', 'shippingTotal',
  'storageTotal', 'adjustmentTotal', 'grandTotal',
] as const;

const ALLOWED_NUMBER_FIELDS = [
  'pickpackTotal', 'additionalTotal', 'packageTotal', 'shippingTotal', 'storageTotal',
  'adjustmentTotal', 'returnPostageTotal', 'returnProcessingTotal', 'returnTotal', 'grandTotal',
] as const;

const ALLOWED_BOOLEAN_FIELDS = [
  'hasReturnPostageLine', 'hasReturnProcessingLine', 'rolledFromWeekend',
] as const;

const ROW_TYPES: readonly string[] = ['Outbound', 'Return'];
const DESTINATIONS: readonly string[] = ['Domestic', 'International', 'Needs Review'];

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Numbers pass through as numbers. A missing/unparseable amount stays NULL — it is NOT
 * coerced to 0. AC-5 turns on that distinction: "not yet billable" and "billed at zero" are
 * different facts, and the portal's old `coalesce(...,0)` erased it.
 */
function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asInteger(value: unknown): number | null {
  const parsed = asNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

/**
 * Validate and allowlist ONE upstream row.
 *
 * `rowType` and `destination` are checked against the exact upstream vocabularies. An
 * unrecognised value becomes null rather than being passed through or guessed at — the portal
 * must not invent a classification it does not understand, and must not present an upstream
 * typo as though it were meaningful.
 */
export function toCanonicalBillingEventRow(input: unknown): CanonicalBillingEventRow | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const row = input as Record<string, unknown>;

  /*
   * MANDATORY FACTS. A row missing any of these is NOT a canonical billing event and is
   * rejected outright — the caller then fails the whole response.
   *
   * An earlier version returned an all-null row for any object at all, including `{}`. That
   * looked like validation and was not: the null row flowed through to the serializers, where
   * `present === false ? dash : money(value)` treated NULL presence as "present" and printed
   * `money(null)` — a fabricated `$0.00` on a printed invoice and in the XLSX, while the grid
   * showed a dash for the same row. So an upstream contract mismatch rendered as customer
   * billing activity, the three surfaces disagreed, and the boundary still claimed fail-closed.
   *
   * Each field below is stamped unconditionally by PrepShip's canonical row builder —
   * `classifyDestinationCountry` always returns one of the three destinations ('Needs Review'
   * is a real answer, not an absent one), and both presence flags are set from the line type.
   * Requiring them cannot reject a well-formed production row.
   */
  const rowTypeValid = typeof row.rowType === 'string' && ROW_TYPES.includes(row.rowType);
  const destinationValid = typeof row.destination === 'string' && DESTINATIONS.includes(row.destination);
  const postagePresenceValid = typeof row.hasReturnPostageLine === 'boolean';
  const processingPresenceValid = typeof row.hasReturnProcessingLine === 'boolean';

  /*
   * IDENTITY, not orderId.
   *
   * This used to require a non-null `orderId`. PrepShip emits STORAGE lines with
   * `orderId: null, orderNumber: null` (billing.ts:2360) — a deliberate contract its own
   * `rowKey` handles explicitly. Requiring orderId therefore rejected every storage row, and
   * since one rejected row fails the whole response, any period containing storage billing
   * returned 502. That is the same mistake as the `false + 0` rule: the consumer demanding a
   * shape the producer never promised.
   *
   * `canonicalEventId` is what actually identifies an event row, for every shape including the
   * orderless ones. PrepShip derives it from the same key it files the aggregate under and
   * publishes it opaque. The portal consumes it and never derives identity itself — not from
   * displayReference, description, amount or row index.
   */
  const canonicalEventId = typeof row.canonicalEventId === 'string' && row.canonicalEventId.length > 0
    ? row.canonicalEventId
    : null;

  /*
   * PRODUCER-GUARANTEED MONEY.
   *
   * These seven are declared `: number` on BillingDetailRowDto and commented there as "always
   * present, always numbers (the PS-369 FE contract)". A row missing them is not a billing event
   * — and accepting one was customer-visible: the serializers read `Number(value ?? 0)`, so a
   * row with no grandTotal printed a plausible $0.00 invoice line for money nobody had computed.
   *
   * The three RETURN totals are deliberately absent from this list. They are declared
   * `?: number` — optional — on the producer DTO, and requiring them would be the consumer
   * asserting a stricter contract than the producer publishes, which is exactly how the last two
   * outages happened. Their presence is governed by the presence flags below instead.
   */
  const moneyValid = REQUIRED_NUMBER_FIELDS.every((field) => asNumber(row[field]) !== null);

  if (canonicalEventId === null || !rowTypeValid || !destinationValid
    || !postagePresenceValid || !processingPresenceValid || !moneyValid) {
    return null;
  }

  /*
   * PRESENCE IS THE ONLY SIGNAL. The amount's nullability means nothing.
   *
   * An earlier version of this function also required presence and amount to "agree": it
   * rejected `present: false` carrying any number. That was read off this repository's own
   * fixtures rather than off the producer, and it was wrong in the most expensive possible way.
   *
   * PrepShip types `returnPostageTotal` as `number` (not `number | null`) and assigns it
   * `isReturnPostageLine ? lineTotal : 0` — billing-detail-row-sot.ts:281 — so the ABSENT case
   * is `hasReturnPostageLine: false` with a numeric `0`, never null. That is the shape of
   * every outbound row and of every processing-only return. The rule therefore rejected
   * essentially the entire result set, and because one bad row fails the whole response, the
   * Billing detail endpoint would have returned 502 for every request in production.
   *
   * It went unnoticed because every fixture in this repo used `false + null` — a shape the
   * producer never emits. Green lanes against an invented contract prove nothing about the real
   * one. The fixtures now use `false + 0`, which is what PrepShip actually sends.
   *
   * What still holds: presence decides rendering (`present === true` renders money, anything
   * else blanks), so an absent fee and a real $0.00 fee stay distinguishable — AC-5 — without
   * the amount's nullability carrying any meaning at all.
   *
   * The one contradiction still rejected is `present: true` with no amount: claiming a fee
   * exists while withholding its value cannot be rendered honestly, and PrepShip never emits it
   * (a present line always carries its numeric lineTotal).
   */
  if (row.hasReturnPostageLine === true && asNumber(row.returnPostageTotal) === null) return null;
  if (row.hasReturnProcessingLine === true && asNumber(row.returnProcessingTotal) === null) return null;

  const out: Record<string, unknown> = {
    clientId: asInteger(row.clientId),
    // Producer-issued. The portal carries it verbatim and never mints one.
    canonicalEventId,
    // Null for a storage line, which has no order. That is a real shape, not a missing value.
    orderId: asInteger(row.orderId),
    // Relational return identity is kept in whatever scalar form upstream issued it.
    returnId: typeof row.returnId === 'number' || typeof row.returnId === 'string'
      ? row.returnId
      : null,
    rowType: typeof row.rowType === 'string' && ROW_TYPES.includes(row.rowType)
      ? row.rowType as CanonicalBillingRowType
      : null,
    destination: typeof row.destination === 'string' && DESTINATIONS.includes(row.destination)
      ? row.destination as CanonicalBillingDestination
      : null,
    qty: typeof row.qty === 'number' || typeof row.qty === 'string' ? row.qty : null,
  };

  for (const field of ALLOWED_STRING_FIELDS) out[field] = asString(row[field]);
  for (const field of ALLOWED_NUMBER_FIELDS) out[field] = asNumber(row[field]);
  for (const field of ALLOWED_BOOLEAN_FIELDS) out[field] = asBoolean(row[field]);

  return out as unknown as CanonicalBillingEventRow;
}

export interface CanonicalBillingDetailsQuery {
  dateFrom: string;
  dateTo: string;
  clientId?: number;
}

export type CanonicalBillingDetailsResult =
  | { ok: true; rows: CanonicalBillingEventRow[] }
  | { ok: false; status: number; error: string; code: string };

/**
 * Fetch the canonical event rows for the caller's own scope.
 *
 * Fails CLOSED on every uncertainty — missing configuration, transport failure, non-2xx, or a
 * response whose shape is not an array of objects. A billing surface that renders an empty
 * grid on an upstream error looks identical to a client with no activity, and that is a
 * customer-visible lie about money.
 */
export async function fetchCanonicalBillingDetails(
  authorization: string,
  query: CanonicalBillingDetailsQuery,
  requestId?: string,
): Promise<CanonicalBillingDetailsResult> {
  if (!env.PREPSHIP_API_URL) {
    return {
      ok: false,
      status: 503,
      code: 'prep_ship_billing_unavailable',
      error: 'Billing details are not configured. Set PREPSHIP_API_URL on the Client Portal API.',
    };
  }

  const params = new URLSearchParams({ dateFrom: query.dateFrom, dateTo: query.dateTo });
  if (query.clientId !== undefined) params.set('clientId', String(query.clientId));

  let upstream: Response;
  try {
    const baseUrl = env.PREPSHIP_API_URL.replace(/\/+$/, '');
    upstream = await fetch(`${baseUrl}/billing/details?${params.toString()}`, {
      method: 'GET',
      headers: {
        authorization,
        accept: 'application/json',
        ...(requestId ? { 'x-request-id': requestId } : {}),
      },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    console.error(
      '[client-portal] canonical billing details unavailable:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return {
      ok: false,
      status: 502,
      code: 'prep_ship_billing_unavailable',
      error: 'PrepShip billing details are temporarily unavailable. Please try again.',
    };
  }

  const body = (await upstream.json().catch(() => null)) as Record<string, unknown> | null;

  if (!upstream.ok) {
    // Upstream scope denials are forwarded as-is in STATUS but never in DETAIL: the portal
    // must not leak which client ids exist by varying its message.
    const status = upstream.status === 401 || upstream.status === 403 ? upstream.status : 502;
    return {
      ok: false,
      status,
      code: status === 502 ? 'prep_ship_billing_unavailable' : 'forbidden',
      error: status === 502
        ? 'PrepShip billing details are temporarily unavailable. Please try again.'
        : 'Not found',
    };
  }

  const raw = Array.isArray(body?.data) ? body!.data : Array.isArray(body) ? body : null;
  if (!raw) {
    return {
      ok: false,
      status: 502,
      code: 'prep_ship_billing_contract_mismatch',
      error: 'PrepShip billing details returned an unexpected shape.',
    };
  }

  // A malformed row fails the WHOLE response. Skipping it would silently drop a billing event
  // and show the customer a shorter invoice than they were billed for — quietly losing a line
  // is worse than showing an error, because nobody can tell it happened.
  const rows: CanonicalBillingEventRow[] = [];
  for (const [index, entry] of raw.entries()) {
    const row = toCanonicalBillingEventRow(entry);
    if (!row) {
      console.error(
        `[client-portal] canonical billing row ${index} failed contract validation; `
        + 'rejecting the response rather than rendering a partial invoice',
      );
      return {
        ok: false,
        status: 502,
        code: 'prep_ship_billing_contract_mismatch',
        error: 'PrepShip billing details returned a row that does not match the expected contract.',
      };
    }
    rows.push(row);
  }
  return { ok: true, rows };
}
