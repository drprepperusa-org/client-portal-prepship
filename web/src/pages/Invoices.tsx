import { useEffect, useState } from 'react';
import { CalendarDays, Check, Download, Pencil, RotateCcw, X } from 'lucide-react';
import { DataTable, EmptyState, ErrorNotice, ErrorPanel, PageHeader, Panel, RefreshButton, TableSkeleton } from '../components/PortalPrimitives';
import { StoreBadge, storeNameForClient } from '../components/StoreScopeControls';
import { defaultRange, portalApi, safeDate, safeMoney, safeNumber } from '../lib/api';
import { useAuth } from '../lib/auth';
import { DEMO_TOKEN } from '../lib/demo-data';
import {
  adjustedInvoiceRow,
  calculatedInvoiceRowTotal,
  loadInvoiceRowAdjustments,
  invoiceNumber,
  invoiceTotalsForRows,
  saveInvoiceRowAdjustments,
  type InvoiceRowAdjustment,
} from '../lib/invoiceAdjustments';
import { useBillingQuery, useClientsQuery, useInvoiceDetailsQuery, useMeQuery } from '../lib/portalQueries';
import type { BillingInvoiceDetailRow, PortalClient } from '../types/portal';

function clientRows(value: unknown): PortalClient[] {
  if (Array.isArray(value)) return value as PortalClient[];
  if (value && typeof value === 'object' && Array.isArray((value as { data?: unknown }).data)) return (value as { data: PortalClient[] }).data;
  return [];
}

function pickPackTotal(row: { pickPackTotal?: number | string; pickpackTotal?: number | string }) {
  return row.pickPackTotal ?? row.pickpackTotal ?? 0;
}

function invoiceRowKey(row: BillingInvoiceDetailRow) {
  return [
    row.clientId ?? 'client',
    row.orderId ?? row.orderNumber ?? 'row',
    row.shipDate ?? 'date',
    row.recipientName ?? 'recipient',
    row.itemNames ?? 'items',
  ].join('-');
}

function moneyValue(value: unknown) {
  return invoiceNumber(value);
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function openDatePicker(input: HTMLInputElement) {
  const picker = input as HTMLInputElement & { showPicker?: () => void };
  try {
    picker.showPicker?.();
  } catch {
    input.focus();
  }
}

type InvoiceEditDraft = {
  qty: string;
  pickpackTotal: string;
  packageTotal: string;
  shippingTotal: string;
  rowTotal: string;
};

function editDraftFromRow(row: BillingInvoiceDetailRow): InvoiceEditDraft {
  return {
    qty: String(invoiceNumber(row.qty)),
    pickpackTotal: invoiceNumber(row.pickpackTotal).toFixed(2),
    packageTotal: invoiceNumber(row.packageTotal).toFixed(2),
    shippingTotal: invoiceNumber(row.shippingTotal).toFixed(2),
    rowTotal: invoiceNumber(row.rowTotal).toFixed(2),
  };
}

export default function Invoices() {
  const initialRange = defaultRange();
  const [range, setRange] = useState(initialRange);
  const auth = useAuth();
  const me = useMeQuery(auth.accessToken);
  const clients = useClientsQuery(auth.accessToken);
  const billing = useBillingQuery(auth.accessToken, range);
  const invoiceDetails = useInvoiceDetailsQuery(auth.accessToken, range);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [busyClient, setBusyClient] = useState<number | null>(null);
  const [selectedExcludeKeys, setSelectedExcludeKeys] = useState<Set<string>>(new Set());
  const [excludedKeys, setExcludedKeys] = useState<Set<string>>(new Set());
  const [rowAdjustments, setRowAdjustments] = useState<Record<string, InvoiceRowAdjustment>>(() => {
    if (typeof window === 'undefined') return {};
    return loadInvoiceRowAdjustments(window.localStorage);
  });
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<InvoiceEditDraft | null>(null);
  const [preEditAdjustment, setPreEditAdjustment] = useState<InvoiceRowAdjustment | null>(null);
  const detailRows = invoiceDetails.data?.data ?? [];
  const adjustedDetailRows = detailRows.map((row) => effectiveInvoiceRow(row));
  const includedRows = adjustedDetailRows.filter((row) => !excludedKeys.has(invoiceRowKey(row)));
  const excludedRowCount = detailRows.length - includedRows.length;
  const selectedExcludeCount = selectedExcludeKeys.size;
  const visibleRowKeys = new Set(detailRows.map((row) => invoiceRowKey(row)));
  const adjustedRowCount = Object.keys(rowAdjustments).filter((key) => visibleRowKeys.has(key)).length;

  useEffect(() => {
    saveInvoiceRowAdjustments(window.localStorage, rowAdjustments);
  }, [rowAdjustments]);

  function updateFrom(nextFrom: string) {
    setRange((current) => ({
      from: nextFrom,
      to: nextFrom > current.to ? nextFrom : current.to,
    }));
    resetInvoiceSelection();
  }

  function updateTo(nextTo: string) {
    setRange((current) => ({
      from: nextTo < current.from ? nextTo : current.from,
      to: nextTo,
    }));
    resetInvoiceSelection();
  }

  function resetRange() {
    setRange(defaultRange());
    resetInvoiceSelection();
  }

  function effectiveInvoiceRow(row: BillingInvoiceDetailRow) {
    return adjustedInvoiceRow(row, rowAdjustments[invoiceRowKey(row)]);
  }

  function toggleExcludeCandidate(rowKey: string, checked: boolean) {
    setSelectedExcludeKeys((current) => {
      const next = new Set(current);
      if (checked) next.add(rowKey);
      else next.delete(rowKey);
      return next;
    });
  }

  function excludeSelectedRows() {
    setExcludedKeys((current) => {
      const next = new Set(current);
      selectedExcludeKeys.forEach((key) => next.add(key));
      return next;
    });
    setSelectedExcludeKeys(new Set());
  }

  function includeAllRows() {
    setExcludedKeys(new Set());
    setSelectedExcludeKeys(new Set());
  }

  function resetInvoiceSelection() {
    includeAllRows();
    setEditingKey(null);
    setEditDraft(null);
    setPreEditAdjustment(null);
  }

  function clearSavedInvoiceEdits() {
    setRowAdjustments((current) => {
      const next = { ...current };
      visibleRowKeys.forEach((key) => {
        delete next[key];
      });
      return next;
    });
    setEditingKey(null);
    setEditDraft(null);
    setPreEditAdjustment(null);
  }

  function startEditRow(row: BillingInvoiceDetailRow) {
    const rowKey = invoiceRowKey(row);
    setEditingKey(rowKey);
    setPreEditAdjustment(rowAdjustments[rowKey] ?? null);
    setEditDraft(editDraftFromRow(effectiveInvoiceRow(row)));
  }

  function cancelEditRow() {
    if (editingKey) {
      setRowAdjustments((current) => {
        const next = { ...current };
        if (preEditAdjustment) next[editingKey] = preEditAdjustment;
        else delete next[editingKey];
        return next;
      });
    }
    setEditingKey(null);
    setEditDraft(null);
    setPreEditAdjustment(null);
  }

  function updateEditDraft(field: keyof InvoiceEditDraft, value: string) {
    if (!editDraft) return;
    const next = { ...editDraft, [field]: value };
    if (field !== 'rowTotal' && editingKey) {
      const sourceRow = detailRows.find((row) => invoiceRowKey(row) === editingKey);
      if (sourceRow) {
        const preview = adjustedInvoiceRow(effectiveInvoiceRow(sourceRow), next);
        next.rowTotal = calculatedInvoiceRowTotal(preview).toFixed(2);
      }
    }
    setEditDraft(next);
    if (editingKey) {
      setRowAdjustments((adjustments) => ({
        ...adjustments,
        [editingKey]: {
          qty: next.qty,
          pickpackTotal: next.pickpackTotal,
          packageTotal: next.packageTotal,
          shippingTotal: next.shippingTotal,
          rowTotal: next.rowTotal,
        },
      }));
    }
  }

  function saveEditRow(row: BillingInvoiceDetailRow) {
    if (!editDraft) return;
    const rowKey = invoiceRowKey(row);
    setRowAdjustments((current) => ({
      ...current,
      [rowKey]: {
        qty: editDraft.qty,
        pickpackTotal: editDraft.pickpackTotal,
        packageTotal: editDraft.packageTotal,
        shippingTotal: editDraft.shippingTotal,
        rowTotal: editDraft.rowTotal,
      },
    }));
    setEditingKey(null);
    setEditDraft(null);
    setPreEditAdjustment(null);
  }

  function resetEditedRow(row: BillingInvoiceDetailRow) {
    const rowKey = invoiceRowKey(row);
    setRowAdjustments((current) => {
      const next = { ...current };
      delete next[rowKey];
      return next;
    });
    if (editingKey === rowKey) cancelEditRow();
  }

  function adjustedSummaryForClient(clientId: number | undefined, fallback: { orderCount?: number; pickPackTotal?: number | string; pickpackTotal?: number | string; packageTotal?: number | string; grandTotal?: number | string }) {
    const clientDetailRows = clientId ? adjustedDetailRows.filter((row) => row.clientId === clientId) : adjustedDetailRows;
    if (clientDetailRows.length === 0) {
      return {
        orderCount: fallback.orderCount,
        qtyTotal: undefined,
        pickPackTotal: pickPackTotal(fallback),
        packageTotal: fallback.packageTotal,
        grandTotal: fallback.grandTotal,
      };
    }

    const billableRows = clientDetailRows.filter((row) => !excludedKeys.has(invoiceRowKey(row)));
    const totals = invoiceTotalsForRows(billableRows);
    return {
      orderCount: billableRows.length,
      qtyTotal: totals.qtyTotal,
      pickPackTotal: totals.pickpackTotal,
      packageTotal: totals.packageTotal,
      grandTotal: totals.grandTotal,
    };
  }

  function adjustedInvoiceHtml(clientId: number, clientName: string) {
    const clientDetailRows = adjustedDetailRows.filter((row) => row.clientId === clientId);
    const billableRows = clientDetailRows.filter((row) => !excludedKeys.has(invoiceRowKey(row)));
    const totals = invoiceTotalsForRows(billableRows);
    const generated = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const rows = billableRows
      .map((row) => `
        <tr>
          <td>${escapeHtml(safeDate(row.shipDate))}</td>
          <td class="mono">${escapeHtml(row.orderNumber ?? row.orderId ?? '')}</td>
          <td>${escapeHtml(row.recipientName ?? '')}</td>
          <td>${escapeHtml(row.itemNames ?? '')}</td>
          <td class="num">${escapeHtml(safeNumber(row.qty))}</td>
          <td class="num">${escapeHtml(safeMoney(row.pickpackTotal))}</td>
          <td class="num">${moneyValue(row.additionalTotal) > 0 ? escapeHtml(safeMoney(row.additionalTotal)) : '-'}</td>
          <td class="num">${moneyValue(row.packageTotal) > 0 ? escapeHtml(safeMoney(row.packageTotal)) : '-'}</td>
          <td class="num">${moneyValue(row.shippingTotal) > 0 ? escapeHtml(safeMoney(row.shippingTotal)) : '-'}</td>
          <td class="num bold">${escapeHtml(safeMoney(row.rowTotal))}</td>
        </tr>`)
      .join('');

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PrepShip Invoice - ${escapeHtml(clientName)} - ${escapeHtml(range.from)} to ${escapeHtml(range.to)}</title>
  <style>
    *{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;margin:0 auto;max-width:1120px;padding:40px 48px;color:#111827;background:#fff;font-size:13px}.print-tip{margin-bottom:24px;border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:10px;padding:10px 14px}.notice{margin-bottom:18px;border:1px solid #fecaca;background:#fef2f2;color:#991b1b;border-radius:10px;padding:10px 14px;font-weight:700}.header{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;border-bottom:2px solid #e5e7eb;padding-bottom:20px;margin-bottom:22px}.brand h1{font-size:28px;line-height:1;margin:0 0 6px;font-weight:800}.muted{color:#6b7280}.client{text-align:right}.client strong{display:block;font-size:18px}.summary{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin:22px 0}.card{border:1px solid #e5e7eb;border-radius:10px;padding:12px}.label{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;font-weight:800}.value{margin-top:4px;font-size:17px;font-weight:800}.total{display:flex;justify-content:space-between;align-items:center;background:#f0fdf4;border:1px solid #86efac;color:#166534;border-radius:10px;padding:14px 18px;margin-bottom:24px}.total b{font-size:24px}table{width:100%;border-collapse:collapse}th{background:#f9fafb;color:#374151;text-transform:uppercase;font-size:10px;letter-spacing:.06em}td,th{border:1px solid #e5e7eb;padding:8px 10px;text-align:left}tbody tr:nth-child(even){background:#fafafa}.num{text-align:right}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#2563eb}.bold{font-weight:800}tfoot td{font-weight:800;background:#f3f4f6}.footer{border-top:1px solid #e5e7eb;color:#9ca3af;margin-top:24px;padding-top:12px;text-align:center;font-size:11px}@media print{.print-tip{display:none}body{padding:18px;max-width:none}}
  </style>
</head>
<body>
  <div class="print-tip">To save as PDF: press <strong>Ctrl+P</strong>, then choose <strong>Save as PDF</strong>.</div>
  ${excludedRowCount || adjustedRowCount ? `<div class="notice">Adjusted invoice preview: ${escapeHtml(safeNumber(excludedRowCount))} row(s) excluded and ${escapeHtml(safeNumber(adjustedRowCount))} row(s) edited from this portal total.</div>` : ''}
  <div class="header">
    <div class="brand"><h1>PrepShip Invoice</h1><div class="muted">DR Prepper 3PL Services</div><div class="muted">Generated ${escapeHtml(generated)}</div></div>
    <div class="client"><strong>${escapeHtml(clientName)}</strong><span class="muted">${escapeHtml(range.from)} to ${escapeHtml(range.to)}</span></div>
  </div>
  <div class="summary">
    <div class="card"><div class="label">Orders</div><div class="value">${escapeHtml(safeNumber(billableRows.length))}</div></div>
    <div class="card"><div class="label">Qty</div><div class="value">${escapeHtml(safeNumber(totals.qtyTotal))}</div></div>
    <div class="card"><div class="label">Pick/pack</div><div class="value">${escapeHtml(safeMoney(totals.pickpackTotal))}</div></div>
    <div class="card"><div class="label">Box fee</div><div class="value">${escapeHtml(safeMoney(totals.packageTotal))}</div></div>
    <div class="card"><div class="label">Shipping</div><div class="value">${escapeHtml(safeMoney(totals.shippingTotal))}</div></div>
    <div class="card"><div class="label">Storage</div><div class="value">${escapeHtml(safeMoney(totals.storageTotal))}</div></div>
  </div>
  <div class="total"><span>Total amount due</span><b>${escapeHtml(safeMoney(totals.grandTotal))}</b></div>
  <table>
    <thead><tr><th>Ship date</th><th>Order</th><th>Recipient</th><th>Item name</th><th class="num">Qty</th><th class="num">Pick/pack</th><th class="num">Additional</th><th class="num">Box fee</th><th class="num">Shipping</th><th class="num">Row total</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="10">No billable order rows found for this adjusted period.</td></tr>'}</tbody>
    <tfoot><tr><td colspan="5">${escapeHtml(safeNumber(billableRows.length))} orders / ${escapeHtml(safeNumber(totals.qtyTotal))} qty</td><td class="num">${escapeHtml(safeMoney(totals.pickpackTotal))}</td><td class="num">${escapeHtml(safeMoney(totals.additionalTotal))}</td><td class="num">${escapeHtml(safeMoney(totals.packageTotal))}</td><td class="num">${escapeHtml(safeMoney(totals.shippingTotal))}</td><td class="num">${escapeHtml(safeMoney(totals.grandTotal))}</td></tr></tfoot>
  </table>
  <div class="footer">PrepShip adjusted invoice preview generated ${escapeHtml(generated)} for ${escapeHtml(clientName)}.</div>
</body>
</html>`;
  }

  async function downloadInvoice(clientId: number | undefined) {
    if (!clientId || !auth.accessToken) return;
    setBusyClient(clientId);
    setDownloadError(null);
    const dateFrom = `${range.from}T00:00:00.000Z`;
    const dateTo = `${range.to}T23:59:59.999Z`;
    try {
      const clientName = storeNameForClient(clientRows(clients.data), clientId);
      const hasClientExclusions = detailRows.some((row) => row.clientId === clientId && excludedKeys.has(invoiceRowKey(row)));
      const hasClientAdjustments = detailRows.some((row) => row.clientId === clientId && rowAdjustments[invoiceRowKey(row)]);
      const hasClientDetailRows = detailRows.some((row) => row.clientId === clientId);
      const html =
        hasClientExclusions || hasClientAdjustments || hasClientDetailRows
          ? adjustedInvoiceHtml(clientId, clientName)
          : auth.accessToken === DEMO_TOKEN
          ? `<h1>DrPrepperUSA Invoice</h1><p>Demo invoice for client ${clientId}</p>`
          : await portalApi.clientPortal.invoice(auth.accessToken, { clientId, dateFrom, dateTo });
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const opened = window.open(url, '_blank', 'noopener,noreferrer');
      if (!opened) {
        URL.revokeObjectURL(url);
        throw new Error('Your browser blocked the invoice window. Allow popups for this portal and try again.');
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyClient(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Invoices"
        subtitle="Billing summaries are visible only for admin accounts or portal users explicitly granted billing visibility."
        action={<RefreshButton loading={billing.isFetching || me.isFetching || invoiceDetails.isFetching} onClick={() => { void billing.refetch(); void me.refetch(); void invoiceDetails.refetch(); }} />}
      />
      {billing.error ? (
        <div className="mb-5">
          <ErrorPanel
            message={billing.error instanceof Error ? billing.error.message : String(billing.error)}
            loading={billing.isFetching}
            onRetry={() => void billing.refetch()}
          />
        </div>
      ) : null}
      {downloadError ? <div className="mb-5"><ErrorNotice message={downloadError} /></div> : null}
      {invoiceDetails.error ? (
        <div className="mb-5">
          <ErrorPanel
            message={invoiceDetails.error instanceof Error ? invoiceDetails.error.message : String(invoiceDetails.error)}
            loading={invoiceDetails.isFetching}
            onRetry={() => void invoiceDetails.refetch()}
          />
        </div>
      ) : null}
      <section className="mb-5 rounded-card bg-surface px-4 py-3 ring-1 ring-line">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-sm font-black text-ink">Invoice date range</div>
            <div className="mt-1 text-xs font-bold text-ink-3">{range.from} to {range.to}</div>
          </div>
          <div className="grid gap-2 sm:grid-cols-[170px_170px_auto] sm:items-end">
            <label className="block">
              <span className="flex items-center gap-1.5 text-[10px] font-black uppercase text-ink-3">
                <CalendarDays size={12} /> Start date
              </span>
              <div className="relative mt-1">
                <input
                  type="date"
                  value={range.from}
                  max={range.to}
                  onClick={(event) => openDatePicker(event.currentTarget)}
                  onFocus={(event) => openDatePicker(event.currentTarget)}
                  onChange={(event) => updateFrom(event.target.value)}
                  className="invoice-date-picker h-9 w-full rounded-lg border border-line bg-surface px-3 pr-8 text-sm font-black text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15"
                />
                <CalendarDays className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3" size={14} />
              </div>
            </label>
            <label className="block">
              <span className="flex items-center gap-1.5 text-[10px] font-black uppercase text-ink-3">
                <CalendarDays size={12} /> End date
              </span>
              <div className="relative mt-1">
                <input
                  type="date"
                  value={range.to}
                  min={range.from}
                  onClick={(event) => openDatePicker(event.currentTarget)}
                  onFocus={(event) => openDatePicker(event.currentTarget)}
                  onChange={(event) => updateTo(event.target.value)}
                  className="invoice-date-picker h-9 w-full rounded-lg border border-line bg-surface px-3 pr-8 text-sm font-black text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15"
                />
                <CalendarDays className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3" size={14} />
              </div>
            </label>
            <button
              type="button"
              onClick={resetRange}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-line bg-surface px-4 text-xs font-black text-ink-2 transition-all duration-200 hover:-translate-y-0.5 hover:bg-brand-bg hover:text-brand active:translate-y-0 motion-reduce:transform-none"
            >
              <RotateCcw size={14} /> Last 30 days
            </button>
          </div>
        </div>
      </section>
      <div className="h-5" />
      <Panel title={`Billing window ${range.from} to ${range.to}`}>
        {billing.isLoading && !billing.data ? (
          <TableSkeleton rows={5} columns={5} />
        ) : (
          <div className="divide-y divide-line">
            {(billing.data?.data ?? []).map((row, index) => {
              const adjusted = adjustedSummaryForClient(row.clientId, row);
              return (
                <div key={row.clientId ?? index} className="grid gap-4 px-5 py-5 md:grid-cols-[1fr_repeat(4,0.7fr)_auto] md:items-center">
                  <div>
                    <StoreBadge name={storeNameForClient(clientRows(clients.data), row.clientId, row.clientName)} />
                    <div className="mt-1 text-xs font-semibold text-ink-3">
                      {safeNumber(adjusted.orderCount)} orders
                      {excludedRowCount ? <span className="ml-2 text-danger">({safeNumber(excludedRowCount)} excluded)</span> : null}
                      {adjustedRowCount ? <span className="ml-2 text-brand">({safeNumber(adjustedRowCount)} edited)</span> : null}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-black uppercase text-ink-3">Qty</div>
                    <div className="mt-1 text-sm font-black text-ink">{adjusted.qtyTotal === undefined ? '-' : safeNumber(adjusted.qtyTotal)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-black uppercase text-ink-3">Pick/pack</div>
                    <div className="mt-1 text-sm font-black text-ink">{safeMoney(adjusted.pickPackTotal)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-black uppercase text-ink-3">Box fee</div>
                    <div className="mt-1 text-sm font-black text-ink">{safeMoney(adjusted.packageTotal)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-black uppercase text-ink-3">Total</div>
                    <div className="mt-1 text-sm font-black text-ink">{safeMoney(adjusted.grandTotal)}</div>
                  </div>
                  {row.clientId ? (
                    <button type="button" onClick={() => void downloadInvoice(row.clientId)} disabled={busyClient === row.clientId} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-brand px-3 text-xs font-black text-white transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm active:scale-[0.985] disabled:opacity-60 disabled:hover:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none">
                      {busyClient === row.clientId ? 'Opening...' : 'Open invoice'} <Download size={13} />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        {!billing.isLoading && (billing.data?.data.length ?? 0) === 0 ? (
          <EmptyState
            title={me.data?.canViewFinancials ? 'No invoices available' : 'Invoice visibility not enabled'}
            body={
              me.data?.canViewFinancials
                ? 'No billable invoice rows were found for your current scoped stores in this billing window.'
                : 'This store-level account does not have billing visibility. An admin can grant financials:read when needed.'
            }
          />
        ) : null}
      </Panel>
      <div className="h-5" />
      <Panel
        title="Billable order details"
        right={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="text-xs font-bold text-ink-3">
              {safeNumber(includedRows.length)} included / {safeNumber(detailRows.length)} row(s)
            </span>
            <button
              type="button"
              onClick={excludeSelectedRows}
              disabled={selectedExcludeCount === 0}
              className="inline-flex h-8 items-center justify-center rounded-lg bg-danger px-3 text-[11px] font-black text-white transition-all duration-200 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 motion-reduce:transform-none"
            >
              Don't include selected
            </button>
            {excludedRowCount ? (
              <button
                type="button"
                onClick={includeAllRows}
                className="inline-flex h-8 items-center justify-center rounded-lg border border-line bg-surface px-3 text-[11px] font-black text-ink-2 transition-colors hover:bg-brand-bg hover:text-brand"
              >
                Include all
              </button>
            ) : null}
            {adjustedRowCount ? (
              <button
                type="button"
                onClick={clearSavedInvoiceEdits}
                className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-[11px] font-black text-ink-2 transition-colors hover:bg-brand-bg hover:text-brand"
              >
                <RotateCcw size={13} /> Reset edits
              </button>
            ) : null}
          </div>
        }
      >
        {invoiceDetails.isLoading && !invoiceDetails.data ? (
          <TableSkeleton rows={6} columns={8} />
        ) : (
          <DataTable<BillingInvoiceDetailRow>
            tableId="invoice-order-details-v4"
            rows={detailRows}
            getRowKey={invoiceRowKey}
            columns={[
              {
                key: 'actions',
                header: 'Actions',
                width: '150px',
                render: (row) => {
                  const rowKey = invoiceRowKey(row);
                  const isEditing = editingKey === rowKey;
                  const hasEdit = Boolean(rowAdjustments[rowKey]);
                  return isEditing ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => saveEditRow(row)}
                        className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-white transition-colors hover:bg-brand/90"
                        aria-label={`Save invoice row ${row.orderNumber ?? rowKey}`}
                        title="Save"
                      >
                        <Check size={15} />
                      </button>
                      <button
                        type="button"
                        onClick={cancelEditRow}
                        className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface text-ink-2 transition-colors hover:bg-surface-2"
                        aria-label={`Cancel invoice row ${row.orderNumber ?? rowKey}`}
                        title="Cancel"
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => startEditRow(row)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-[11px] font-black text-ink-2 transition-colors hover:bg-brand-bg hover:text-brand"
                      >
                        <Pencil size={13} /> Edit
                      </button>
                      {hasEdit ? (
                        <button
                          type="button"
                          onClick={() => resetEditedRow(row)}
                          className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
                          aria-label={`Reset invoice row ${row.orderNumber ?? rowKey}`}
                          title="Reset row"
                        >
                          <RotateCcw size={13} />
                        </button>
                      ) : null}
                    </div>
                  );
                },
              },
              {
                key: 'include',
                header: 'Billable',
                width: '110px',
                render: (row) => {
                  const rowKey = invoiceRowKey(row);
                  const excluded = excludedKeys.has(rowKey);
                  const selected = selectedExcludeKeys.has(rowKey);
                  return (
                    <label className="inline-flex items-center gap-2 text-[11px] font-black text-ink-2">
                      <input
                        type="checkbox"
                        checked={excluded || selected}
                        disabled={excluded}
                        onChange={(event) => toggleExcludeCandidate(rowKey, event.target.checked)}
                        className="h-4 w-4 rounded border-line text-brand accent-[var(--theme-blue)] disabled:opacity-60"
                      />
                      {excluded ? 'Excluded' : 'Select'}
                    </label>
                  );
                },
              },
              {
                key: 'client',
                header: 'Client',
                width: '190px',
                render: (row) => <StoreBadge name={storeNameForClient(clientRows(clients.data), row.clientId, row.clientName ?? undefined)} />,
              },
              {
                key: 'order',
                header: 'Order',
                width: '145px',
                render: (row) => <span className="font-black text-ink">{row.orderNumber ?? row.orderId ?? 'Unassigned'}</span>,
              },
              {
                key: 'recipient',
                header: 'Recipient',
                width: '190px',
                render: (row) => <span className="font-semibold text-ink-2">{row.recipientName ?? '-'}</span>,
              },
              {
                key: 'itemNames',
                header: 'Item name',
                width: '280px',
                render: (row) => <span className="line-clamp-2 font-semibold text-ink-2">{row.itemNames ?? '-'}</span>,
              },
              {
                key: 'shipDate',
                header: 'Ship date',
                width: '130px',
                render: (row) => <span className="font-semibold text-ink-2">{safeDate(row.shipDate)}</span>,
              },
              {
                key: 'qty',
                header: 'Qty',
                className: 'right',
                width: '110px',
                render: (row) => {
                  const rowKey = invoiceRowKey(row);
                  if (editingKey === rowKey && editDraft) {
                    return (
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={editDraft.qty}
                        onChange={(event) => updateEditDraft('qty', event.target.value)}
                        className="h-8 w-20 rounded-lg border border-line bg-surface px-2 text-right text-xs font-black tabular-nums text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                      />
                    );
                  }
                  const effective = effectiveInvoiceRow(row);
                  return <span className="font-black tabular-nums text-ink">{safeNumber(effective.qty)}</span>;
                },
              },
              {
                key: 'pickpack',
                header: 'Pick/pack',
                className: 'right',
                width: '130px',
                render: (row) => {
                  const rowKey = invoiceRowKey(row);
                  if (editingKey === rowKey && editDraft) {
                    return (
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={editDraft.pickpackTotal}
                        onChange={(event) => updateEditDraft('pickpackTotal', event.target.value)}
                        className="h-8 w-24 rounded-lg border border-line bg-surface px-2 text-right text-xs font-bold tabular-nums text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                      />
                    );
                  }
                  const effective = effectiveInvoiceRow(row);
                  return <span className="font-semibold tabular-nums text-ink-2">{safeMoney(effective.pickpackTotal)}</span>;
                },
              },
              {
                key: 'packages',
                header: 'Box fee',
                className: 'right',
                width: '130px',
                render: (row) => {
                  const rowKey = invoiceRowKey(row);
                  if (editingKey === rowKey && editDraft) {
                    return (
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={editDraft.packageTotal}
                        onChange={(event) => updateEditDraft('packageTotal', event.target.value)}
                        className="h-8 w-24 rounded-lg border border-line bg-surface px-2 text-right text-xs font-bold tabular-nums text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                      />
                    );
                  }
                  const effective = effectiveInvoiceRow(row);
                  return <span className="font-semibold tabular-nums text-ink-2">{safeMoney(effective.packageTotal)}</span>;
                },
              },
              {
                key: 'shipping',
                header: 'Shipping',
                className: 'right',
                width: '130px',
                render: (row) => {
                  const rowKey = invoiceRowKey(row);
                  if (editingKey === rowKey && editDraft) {
                    return (
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={editDraft.shippingTotal}
                        onChange={(event) => updateEditDraft('shippingTotal', event.target.value)}
                        className="h-8 w-24 rounded-lg border border-line bg-surface px-2 text-right text-xs font-bold tabular-nums text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                      />
                    );
                  }
                  const effective = effectiveInvoiceRow(row);
                  return <span className="font-semibold tabular-nums text-ink-2">{safeMoney(effective.shippingTotal)}</span>;
                },
              },
              {
                key: 'total',
                header: 'Total',
                className: 'right',
                width: '130px',
                render: (row) => {
                  const rowKey = invoiceRowKey(row);
                  if (editingKey === rowKey && editDraft) {
                    return (
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={editDraft.rowTotal}
                        onChange={(event) => updateEditDraft('rowTotal', event.target.value)}
                        className="h-8 w-24 rounded-lg border border-line bg-surface px-2 text-right text-xs font-black tabular-nums text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
                      />
                    );
                  }
                  const excluded = excludedKeys.has(rowKey);
                  const effective = effectiveInvoiceRow(row);
                  return (
                    <span className={`font-black tabular-nums ${excluded ? 'text-ink-3 line-through' : 'text-ink'}`}>
                      {safeMoney(effective.rowTotal)}
                    </span>
                  );
                },
              },
            ]}
          />
        )}
        {!invoiceDetails.isLoading && (invoiceDetails.data?.data.length ?? 0) === 0 ? (
          <EmptyState
            title="No billable order details"
            body="Billable order rows will appear here when invoice line items exist for the current billing window."
          />
        ) : null}
      </Panel>
    </>
  );
}
