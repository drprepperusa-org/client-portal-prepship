import type { BillingInvoiceDetailRow } from '../types/portal';

export type InvoiceRowAdjustment = {
  qty?: number | string | null;
  pickpackTotal?: number | string | null;
  packageTotal?: number | string | null;
  shippingTotal?: number | string | null;
  rowTotal?: number | string | null;
};

export type InvoiceTotals = {
  qtyTotal: number;
  pickpackTotal: number;
  additionalTotal: number;
  packageTotal: number;
  shippingTotal: number;
  storageTotal: number;
  grandTotal: number;
};

type InvoiceAdjustmentStorage = {
  version: 1;
  adjustments: Record<string, InvoiceRowAdjustment>;
};

type InvoiceAdjustmentStorageApi = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

export const INVOICE_ADJUSTMENTS_STORAGE_KEY = 'clientPortal.invoiceRowAdjustments.v1';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanInvoiceAdjustment(value: unknown): InvoiceRowAdjustment | null {
  if (!isRecord(value)) return null;
  const adjustment: InvoiceRowAdjustment = {};
  for (const key of ['qty', 'pickpackTotal', 'packageTotal', 'shippingTotal', 'rowTotal'] as const) {
    const field = value[key];
    if (typeof field === 'string' || typeof field === 'number' || field === null) {
      adjustment[key] = field;
    }
  }
  return Object.keys(adjustment).length > 0 ? adjustment : null;
}

export function loadInvoiceRowAdjustments(storage: Pick<InvoiceAdjustmentStorageApi, 'getItem'>, key = INVOICE_ADJUSTMENTS_STORAGE_KEY) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<InvoiceAdjustmentStorage>;
    if (parsed.version !== 1 || !isRecord(parsed.adjustments)) return {};
    return Object.entries(parsed.adjustments).reduce<Record<string, InvoiceRowAdjustment>>((acc, [rowKey, value]) => {
      const adjustment = cleanInvoiceAdjustment(value);
      if (adjustment) acc[rowKey] = adjustment;
      return acc;
    }, {});
  } catch {
    return {};
  }
}

export function saveInvoiceRowAdjustments(
  storage: Pick<InvoiceAdjustmentStorageApi, 'setItem' | 'removeItem'>,
  adjustments: Record<string, InvoiceRowAdjustment>,
  key = INVOICE_ADJUSTMENTS_STORAGE_KEY,
) {
  try {
    const cleanAdjustments = Object.entries(adjustments).reduce<Record<string, InvoiceRowAdjustment>>((acc, [rowKey, value]) => {
      const adjustment = cleanInvoiceAdjustment(value);
      if (adjustment) acc[rowKey] = adjustment;
      return acc;
    }, {});
    if (Object.keys(cleanAdjustments).length === 0) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, JSON.stringify({ version: 1, adjustments: cleanAdjustments } satisfies InvoiceAdjustmentStorage));
  } catch {
    // Ignore storage failures so invoice editing still works for the current page session.
  }
}

export function invoiceNumber(value: unknown) {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

export function roundInvoiceNumber(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function adjustedInvoiceRow(row: BillingInvoiceDetailRow, adjustment?: InvoiceRowAdjustment): BillingInvoiceDetailRow {
  if (!adjustment) return row;
  const hasPickPackAdjustment = adjustment.pickpackTotal !== undefined && adjustment.pickpackTotal !== null;
  return {
    ...row,
    qty: adjustment.qty ?? row.qty,
    pickpackTotal: adjustment.pickpackTotal ?? row.pickpackTotal,
    additionalTotal: hasPickPackAdjustment ? 0 : row.additionalTotal,
    packageTotal: adjustment.packageTotal ?? row.packageTotal,
    shippingTotal: adjustment.shippingTotal ?? row.shippingTotal,
    rowTotal: adjustment.rowTotal ?? row.rowTotal,
  };
}

export function invoiceTotalsForRows(rows: BillingInvoiceDetailRow[]): InvoiceTotals {
  return rows.reduce<InvoiceTotals>(
    (totals, row) => ({
      qtyTotal: totals.qtyTotal + invoiceNumber(row.qty),
      pickpackTotal: roundInvoiceNumber(totals.pickpackTotal + invoiceNumber(row.pickpackTotal)),
      additionalTotal: roundInvoiceNumber(totals.additionalTotal + invoiceNumber(row.additionalTotal)),
      packageTotal: roundInvoiceNumber(totals.packageTotal + invoiceNumber(row.packageTotal)),
      shippingTotal: roundInvoiceNumber(totals.shippingTotal + invoiceNumber(row.shippingTotal)),
      storageTotal: roundInvoiceNumber(totals.storageTotal + invoiceNumber(row.storageTotal)),
      grandTotal: roundInvoiceNumber(totals.grandTotal + invoiceNumber(row.rowTotal)),
    }),
    {
      qtyTotal: 0,
      pickpackTotal: 0,
      additionalTotal: 0,
      packageTotal: 0,
      shippingTotal: 0,
      storageTotal: 0,
      grandTotal: 0,
    },
  );
}

export function calculatedInvoiceRowTotal(row: BillingInvoiceDetailRow | InvoiceRowAdjustment) {
  return roundInvoiceNumber(
    invoiceNumber(row.pickpackTotal) +
      invoiceNumber((row as BillingInvoiceDetailRow).additionalTotal) +
      invoiceNumber(row.packageTotal) +
      invoiceNumber(row.shippingTotal) +
      invoiceNumber((row as BillingInvoiceDetailRow).storageTotal),
  );
}
