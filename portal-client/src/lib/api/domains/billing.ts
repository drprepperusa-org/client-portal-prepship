import type {
  BillingInvoiceDetailRow,
  BillingInvoicePeriodSummaryRow,
  BillingInvoiceSummaryRow,
  BillingInvoiceTotals,
  BillingLastGenerated,
  PortalReports,
} from '@client-portal-contracts/billing';
import type { PortalDateRange } from '@client-portal-contracts/common';
import {
  billingRangeFromPortal,
  billingRangeParams,
  defaultRange,
} from '../scope';
import { apiBlob, apiGet, apiPost, apiText } from '../transport';

type BillingGenerateResult = {
  generated: number;
  total: number;
  skipped: number;
  message: string;
  lastGeneratedAt?: string;
};

/**
 * Start a billing update and poll it to completion.
 *
 * PrepShip takes ~25s for a 90-day range while the portal API has a 15s whole-request budget, so
 * the old single POST was killed mid-flight and reported "the server took too long" for work that
 * had already SUCCEEDED upstream (2026-08-30: portal 503 at 15s, upstream 200 at 24.6s). People
 * then clicked again, re-running a real billing regeneration.
 *
 * The POST now returns 202 with a job id and this polls until the job settles. The poll replays
 * the exact status and body the POST used to return, so every existing failure path — 401, 403,
 * 400, the PS-434 weekend 409, the 502 shapes — still arrives here as a thrown ApiError with the
 * same message, and callers need no change.
 */
const BILLING_GENERATE_POLL_MS = 2_000;
// Comfortably past the upstream 120s abort, so a hung run surfaces as a timeout here rather than
// polling forever. Not a cancel: PrepShip keeps going regardless of whether anyone is watching.
const BILLING_GENERATE_MAX_WAIT_MS = 180_000;

async function runBillingGenerate(
  token: string,
  dateFrom: string,
  dateTo: string,
  clientId?: number,
): Promise<BillingGenerateResult> {
  const started = await apiPost<{ jobId?: string; status?: string } & Partial<BillingGenerateResult>>(
    token,
    '/api/client-portal/billing/generate',
    { ...billingRangeParams({ from: dateFrom, to: dateTo }), clientId },
    30_000,
  );
  // A deployment that still answers synchronously returns the finished result, not a job id.
  // Accept it rather than failing on a shape the older API is entitled to send.
  if (!started.jobId) return started as BillingGenerateResult;

  const deadline = Date.now() + BILLING_GENERATE_MAX_WAIT_MS;
  for (;;) {
    await new Promise((resolve) => window.setTimeout(resolve, BILLING_GENERATE_POLL_MS));
    const view = await apiGet<{ status?: string } & Partial<BillingGenerateResult>>(
      token,
      `/api/client-portal/billing/generate/${started.jobId}`,
    );
    // Anything that is not still running IS the settled result: apiGet already threw for every
    // non-2xx, so reaching here with no 'running' marker means success.
    if (view.status !== 'running') return view as BillingGenerateResult;
    if (Date.now() > deadline) {
      throw new Error(
        'The billing update is still running on PrepShip. It has not been cancelled — '
        + 'check Billing in a few minutes before starting another one.',
      );
    }
  }
}

export const billingApi = {
  reports: (token: string, range: PortalDateRange) =>
    apiGet<PortalReports>(token, '/api/client-portal/reports', {
      ...billingRangeFromPortal(range),
    }),
  reportsRange: (token: string, dateFrom: string, dateTo: string) =>
    apiGet<PortalReports>(token, '/api/client-portal/reports', {
      ...billingRangeParams({ from: dateFrom, to: dateTo }),
    }),
  invoiceDetails: (token: string, range: PortalDateRange, clientId?: number) =>
    apiGet<{ data: BillingInvoiceDetailRow[]; billingVisible?: boolean }>(
      token,
      '/api/client-portal/invoice-details',
      { ...billingRangeFromPortal(range), clientId },
    ),
  invoiceDetailsRange: (
    token: string,
    dateFrom: string,
    dateTo: string,
    clientId?: number,
    opts: { page?: number; pageSize?: number; sortBy?: string; sortDir?: 'asc' | 'desc' } = {},
  ) =>
    apiGet<{
      data: BillingInvoiceDetailRow[];
      billingVisible?: boolean;
      pagination?: { page: number; pageSize: number; total: number; totalPages: number };
    }>(token, '/api/client-portal/invoice-details', {
      ...billingRangeParams({ from: dateFrom, to: dateTo }),
      clientId,
      page: opts.page,
      pageSize: opts.pageSize,
      sortBy: opts.sortBy,
      sortDir: opts.sortDir,
    }),
  invoiceSummaryRange: (token: string, dateFrom: string, dateTo: string, clientId?: number) =>
    apiGet<{ data: BillingInvoiceSummaryRow[]; billingVisible?: boolean }>(
      token,
      '/api/client-portal/invoice-summary',
      { ...billingRangeParams({ from: dateFrom, to: dateTo }), clientId },
    ),
  invoicePeriodSummaryRange: (
    token: string,
    dateFrom: string,
    dateTo: string,
    clientId?: number,
    granularity: 'half' | 'month' = 'half',
  ) =>
    apiGet<{
      data: BillingInvoicePeriodSummaryRow[];
      totals?: BillingInvoiceTotals;
      billingVisible?: boolean;
    }>(token, '/api/client-portal/invoice-summary', {
      ...billingRangeParams({ from: dateFrom, to: dateTo }),
      clientId,
      groupBy: 'period',
      granularity,
    }),
  invoiceHtml: (token: string, clientId: number, days = 30) =>
    apiText(token, '/api/client-portal/invoice', {
      clientId,
      ...billingRangeParams(defaultRange(days)),
    }),
  invoiceHtmlRange: (
    token: string,
    clientId: number,
    dateFrom: string,
    dateTo: string,
  ) =>
    apiText(token, '/api/client-portal/invoice', {
      clientId,
      ...billingRangeParams({ from: dateFrom, to: dateTo }),
    }),
  /**
   * CP-068 — PrepShip's invoice workbook for ONE client over a range of days, unmodified.
   * The portal used to assemble its own .xlsx from /invoice-details rows; that was a second
   * serializer of invoice money. The bytes here are the same file PrepShip's own Export serves.
   */
  invoiceWorkbookRange: (token: string, clientId: number, dateFrom: string, dateTo: string) =>
    apiBlob(
      token,
      '/api/client-portal/invoice.xlsx',
      { clientId, ...billingRangeParams({ from: dateFrom, to: dateTo }) },
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ),
  generateBilling: (token: string, dateFrom: string, dateTo: string, clientId?: number) =>
    runBillingGenerate(token, dateFrom, dateTo, clientId),
  billingStatus: (token: string) =>
    apiGet<{ lastGenerated: BillingLastGenerated | null }>(
      token,
      '/api/client-portal/billing/status',
    ),
};
