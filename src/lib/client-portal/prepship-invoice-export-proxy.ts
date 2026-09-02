/**
 * CP-068 — the server-only boundary between the Client Portal and PrepShip's canonical invoice
 * EXPORT artifacts: the `.xlsx` workbook and the `.csv`.
 *
 * WHY THIS EXISTS
 * ---------------
 * The portal used to build its own workbook in the browser (`invoiceExcel.ts`): its own column
 * list, its own cell decisions, a totals row summed client-side over `/invoice-details` rows.
 * That is a SECOND serializer of invoice money. CP-066 removed exactly that class of drift from
 * the printable invoice, which now renders PrepShip's canonical totals; the spreadsheet a
 * customer downloaded beside it still added up its own numbers.
 *
 * PrepShip owns ONE workbook — `GET /billing/invoice.xlsx`, columns from
 * `billing-invoice-columns.ts`, totals as SUM() formulas, money from `billingInvoiceData` with
 * PS-491 duplicate suppression and cancelled-no-charge already applied — and one CSV of the
 * same dataset. DJ's rule is "always the same data whatever export/invoice, excel or CSV",
 * cross-app. Only PrepShip's bytes can satisfy that by construction, so this module fetches
 * them and hands them back UNMODIFIED.
 *
 * WHAT THIS MODULE MUST NEVER DO
 * ------------------------------
 * No cell construction. No column list. No totals. No parsing of the workbook beyond the
 * container signature. No passing a non-spreadsheet body through as though it were one. Each of
 * those would recreate the second owner this replaces.
 *
 * Like the details and totals proxies, the caller's OWN bearer is forwarded — PrepShip
 * re-authorizes the same scope this portal already checked; nothing is minted or widened here.
 */
import { env } from '../env';

export type CanonicalInvoiceExportFormat = 'xlsx' | 'csv';

export const CANONICAL_INVOICE_EXPORT_CONTENT_TYPES: Record<CanonicalInvoiceExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
};

/** The first four bytes of every ZIP container. An .xlsx is a ZIP; anything else is not one. */
const ZIP_LOCAL_FILE_HEADER = [0x50, 0x4b, 0x03, 0x04] as const;

/** Only plain calendar days may cross this boundary — see the note on fetchCanonicalInvoiceExport. */
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A filename PrepShip issues, accepted only in the exact safe shape it emits. */
const SAFE_FILENAME_RE = /^[A-Za-z0-9._-]+\.(?:xlsx|csv)$/;

export type CanonicalInvoiceExportQuery = {
  clientId: number;
  dateFrom: string;
  dateTo: string;
  format: CanonicalInvoiceExportFormat;
};

export type CanonicalInvoiceExportResult =
  | { ok: true; bytes: Uint8Array; contentType: string; filename: string }
  | { ok: false; status: 401 | 403 | 502 | 503; error: string; code: string };

export function isZipContainer(bytes: Uint8Array): boolean {
  return bytes.byteLength >= ZIP_LOCAL_FILE_HEADER.length
    && ZIP_LOCAL_FILE_HEADER.every((byte, index) => bytes[index] === byte);
}

/**
 * The filename PrepShip named the artifact, or the fallback. PrepShip emits
 * `attachment; filename="invoice-<client>-<from>-<to>.<ext>"`; anything else is not trusted
 * into a response header, because a header is exactly where an upstream string can smuggle
 * a second header or a quote.
 */
export function exportFilenameFrom(disposition: string | null, fallback: string): string {
  const match = /filename="([^"]+)"/.exec(disposition ?? '');
  const candidate = match?.[1] ?? '';
  return SAFE_FILENAME_RE.test(candidate) ? candidate : fallback;
}

function unavailable(status: 502 | 503, error: string): CanonicalInvoiceExportResult {
  return { ok: false, status, code: 'prep_ship_invoice_export_unavailable', error };
}

function contractMismatch(error: string): CanonicalInvoiceExportResult {
  return { ok: false, status: 502, code: 'prep_ship_invoice_export_contract_mismatch', error };
}

/**
 * Fetch PrepShip's invoice export for ONE client over a range of DAYS.
 *
 * Days, not instants. PrepShip re-runs its own billingDayRange() on whatever it receives and
 * reads the date part as the LAST INCLUDED day, so an exclusive bound (Sep 01 00:00Z for an
 * August invoice) silently widens the file by a day. That put 9/1 rows inside an August
 * invoice once already. An instant here is a programming error, so it throws rather than
 * being forwarded.
 *
 * Fails CLOSED on every uncertainty — missing configuration, transport failure, non-2xx, a
 * body of the wrong type, an empty body, or an .xlsx that is not a ZIP container. A download
 * that silently delivered an HTML error page named `invoice.xlsx` would look, to the customer,
 * like a broken spreadsheet of their own billing.
 */
export async function fetchCanonicalInvoiceExport(
  authorization: string,
  query: CanonicalInvoiceExportQuery,
  requestId?: string,
): Promise<CanonicalInvoiceExportResult> {
  if (!DAY_RE.test(query.dateFrom) || !DAY_RE.test(query.dateTo)) {
    throw new Error('CP-068: only YYYY-MM-DD days may cross the PrepShip invoice-export boundary');
  }
  if (!env.PREPSHIP_API_URL) {
    return unavailable(503, 'Invoice export is not configured. Set PREPSHIP_API_URL on the Client Portal API.');
  }
  const expectedType = CANONICAL_INVOICE_EXPORT_CONTENT_TYPES[query.format];
  const params = new URLSearchParams({
    clientId: String(query.clientId),
    dateFrom: query.dateFrom,
    dateTo: query.dateTo,
  });

  let upstream: Response;
  try {
    const baseUrl = env.PREPSHIP_API_URL.replace(/\/+$/, '');
    upstream = await fetch(`${baseUrl}/billing/invoice.${query.format}?${params.toString()}`, {
      method: 'GET',
      headers: {
        authorization,
        accept: expectedType,
        ...(requestId ? { 'x-request-id': requestId } : {}),
      },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    console.error(
      '[client-portal] canonical invoice export unavailable:',
      error instanceof Error ? error.message : 'unknown error',
    );
    return unavailable(502, 'PrepShip invoice export is temporarily unavailable. Please try again.');
  }

  if (!upstream.ok) {
    // Scope denials forward their STATUS but never their DETAIL: the portal must not leak
    // which client ids exist by varying its message.
    if (upstream.status === 401 || upstream.status === 403) {
      return { ok: false, status: upstream.status, code: 'forbidden', error: 'Not found' };
    }
    return unavailable(502, 'PrepShip invoice export is temporarily unavailable. Please try again.');
  }

  const contentType = (upstream.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.startsWith(expectedType)) {
    return contractMismatch(`PrepShip invoice export returned an unexpected content type for .${query.format}.`);
  }

  const bytes = new Uint8Array(await upstream.arrayBuffer());
  if (bytes.byteLength === 0) return contractMismatch('PrepShip invoice export returned an empty file.');
  if (query.format === 'xlsx' && !isZipContainer(bytes)) {
    return contractMismatch('PrepShip invoice export returned bytes that are not a workbook.');
  }

  const fallback = `invoice-${query.clientId}-${query.dateFrom}-${query.dateTo}.${query.format}`;
  return {
    ok: true,
    bytes,
    contentType: expectedType,
    filename: exportFilenameFrom(upstream.headers.get('content-disposition'), fallback),
  };
}
