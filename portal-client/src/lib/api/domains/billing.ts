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
import { apiGet, apiPost, apiText } from '../transport';

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
  generateBilling: (token: string, dateFrom: string, dateTo: string, clientId?: number) =>
    apiPost<{
      generated: number;
      total: number;
      skipped: number;
      message: string;
      lastGeneratedAt?: string;
    }>(token, '/api/client-portal/billing/generate', {
      ...billingRangeParams({ from: dateFrom, to: dateTo }),
      clientId,
    }),
  billingStatus: (token: string) =>
    apiGet<{ lastGenerated: BillingLastGenerated | null }>(
      token,
      '/api/client-portal/billing/status',
    ),
};
