import type { BillingInvoiceDetailRow } from './contracts/billing';

/**
 * Printable invoice HTML renderer (extracted from routes/client-portal.ts).
 * Pure string rendering — the route stays responsible for scope/financial
 * gating, the client lookup, and computing the totals it passes in.
 *
 * Layout mirrors the admin app's invoice (Bill To header, seven summary
 * cards, green Total Amount Due bar, SKU-based line table) — but the numbers
 * come from this repo's pure per-component totals (the admin template's
 * Pick & Pack card double-counts additional units; this one does not).
 */

export function escHtml(value: string | number | null | undefined): string {
  return value === null || value === undefined
    ? ''
    : String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export interface InvoiceTotals {
  orderCount: number;
  qty: number;
  pickPackTotal: number;
  additionalTotal: number;
  packageTotal: number;
  shippingTotal: number;
  storageTotal: number;
  returnProcessingTotal: number;
  returnPostageTotal: number;
  grandTotal: number;
}

/**
 * CP-059: typed against the CUSTOMER-SAFE contract, not inferred from the SQL read model.
 *
 * The previous `Awaited<ReturnType<typeof portalInvoiceDetails>>` inherited every column that
 * query happened to select — including `carrierCode`, which AC-7 forbids in customer-facing
 * output. It was never rendered, so nothing leaked, but the print surface was one careless
 * template line away from leaking it and the type would not have objected.
 *
 * Typing against `BillingInvoiceDetailRow` means the allowlist is the only way a field can
 * reach this renderer at all.
 */
type InvoiceDetailRows = BillingInvoiceDetailRow[];

const invoicePrintStyles = `
    * { box-sizing: border-box; }
    body {
      margin: 0 auto;
      max-width: 1120px;
      padding: 40px 48px;
      color: #111827;
      background: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      font-size: 13px;
    }
    .print-tip {
      margin-bottom: 24px;
      border: 1px solid #bfdbfe;
      background: #eff6ff;
      color: #1d4ed8;
      border-radius: 10px;
      padding: 10px 14px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      align-items: flex-start;
      border-bottom: 2px solid #e5e7eb;
      padding-bottom: 20px;
      margin-bottom: 22px;
    }
    .brand h1 { font-size: 28px; line-height: 1; margin: 0 0 6px; font-weight: 800; }
    .muted { color: #6b7280; }
    .client { text-align: right; }
    .client strong { display: block; font-size: 18px; }
    .client .gen { font-size: 11px; color: #9ca3af; }
    .summary { display: grid; grid-template-columns: repeat(7, 1fr); gap: 10px; margin: 22px 0; }
    .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px; }
    .label { font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #6b7280; font-weight: 800; }
    .value { margin-top: 4px; font-size: 17px; font-weight: 800; }
    .total {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #f0fdf4;
      border: 1px solid #86efac;
      color: #166534;
      border-radius: 10px;
      padding: 14px 18px;
      margin-bottom: 24px;
    }
    .total b { font-size: 24px; }
    .trunc-note {
      background: #fffbeb;
      border: 1px solid #fcd34d;
      color: #92400e;
      border-radius: 8px;
      padding: 10px 14px;
      margin-bottom: 20px;
      font-size: 12px;
    }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f9fafb; color: #374151; text-transform: uppercase; font-size: 10px; letter-spacing: .06em; }
    td, th { border: 1px solid #e5e7eb; padding: 8px 10px; text-align: left; }
    .item-name { white-space: pre-line; }
    tbody tr:nth-child(even) { background: #fafafa; }
    .num { text-align: right; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .order-link { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #2563eb; }
    .bold { font-weight: 800; }
    tfoot td { font-weight: 800; background: #f3f4f6; }
    .footer {
      border-top: 1px solid #e5e7eb;
      color: #9ca3af;
      margin-top: 24px;
      padding-top: 12px;
      text-align: center;
      font-size: 11px;
    }
    @media print {
      .print-tip { display: none; }
      body { padding: 18px; max-width: none; }
    }
`;

/** 'YYYY-MM-DD' → 'May 01, 2026' (parsed as plain date, no timezone shift). */
function longDate(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return ymd.slice(0, 10);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' });
}

/** 'YYYY-MM-DD' → 'M/D/YYYY' for line rows. */
function shortDate(ymd: string | null): string {
  if (!ymd) return '';
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return ymd.slice(0, 10);
  return `${m}/${d}/${y}`;
}

function billingActivityDate(detail: InvoiceDetailRows[number]): string {
  const effective = shortDate(detail.billingEffectiveDate ?? detail.shipDate ?? null);
  const actual = shortDate(detail.actualActivityDate ?? detail.shipDate ?? null);
  return detail.rolledFromWeekend && actual && effective !== actual
    ? `Billed ${effective}<br><small>Fulfilled ${actual}</small>`
    : effective;
}

export function renderPortalInvoiceHtml(input: {
  clientName: string | null;
  dateFrom: string;
  dateTo: string;
  invoiceTotals: InvoiceTotals;
  details: InvoiceDetailRows;
  // CP-024: set when the itemized listing below is capped (more billed orders
  // exist than the row cap). The summary/amount-due totals are always complete
  // and canonical; this flag lets the invoice say so rather than let the visible
  // lines silently disagree with the total.
  truncated?: boolean;
}): string {
  const { clientName, dateFrom, dateTo, invoiceTotals, details, truncated } = input;
  const money = (value: unknown) => `$${Number(value ?? 0).toFixed(2)}`;
  const moneyOrDash = (value: unknown) => (Number(value ?? 0) > 0 ? money(value) : '&mdash;');
  const periodFrom = longDate(dateFrom);
  const periodTo = longDate(dateTo);
  const generated = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const truncNote = truncated
    ? '<div class="trunc-note">Amount due above is complete for the full period (' +
      `${invoiceTotals.orderCount.toLocaleString()} orders). The itemized list and its quantity ` +
      'subtotal below are partial (this period exceeds the per-invoice line limit) &mdash; ' +
      'export the period from the Billing page for every line.</div>'
    : '';
  const detailRows = details
    .map((detail) => {
      const skus = detail.skus ?? detail.itemNames ?? '';
      return `
      <tr>
        <td>${billingActivityDate(detail)}</td>
        <td class="order-link">${escHtml(detail.orderNumber ?? detail.orderId ?? '')}</td>
        <td class="mono item-name">${escHtml(skus)}</td>
        <td class="num">${Number(detail.qty ?? 0)}</td>
        <td class="num">${money(detail.pickpackTotal)}</td>
        <td class="num">${moneyOrDash(detail.additionalTotal)}</td>
        <td class="num">${moneyOrDash(detail.packageTotal)}</td>
        <td>${escHtml(detail.boxSize ?? '')}</td>
        <td class="num">${moneyOrDash(detail.shippingTotal)}</td>
        <td class="num">${moneyOrDash(detail.storageTotal)}</td>
        <td class="num">${moneyOrDash(detail.returnProcessingTotal)}</td>
        <td class="num">${moneyOrDash(detail.returnPostageTotal)}</td>
        <td class="num bold">${money(detail.rowTotal)}</td>
      </tr>`;
    })
    .join('');
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PrepShip Invoice - ${escHtml(clientName)} - ${periodFrom} to ${periodTo}</title>
  <style>${invoicePrintStyles}</style>
</head>
<body>
  <div class="print-tip">To save as PDF: press <strong>Ctrl+P</strong> or <strong>&#8984;P</strong>, then choose <strong>Save as PDF</strong>.</div>
  <div class="header">
    <div class="brand"><h1>Invoice</h1><div class="muted">DR Prepper 3PL Services &middot; 14924 S Figueroa St, Gardena CA 90248</div></div>
    <div class="client">
      <strong>Bill To: ${escHtml(clientName)}</strong>
      <span class="muted">Period: ${periodFrom} &rarr; ${periodTo}</span><br>
      <span class="gen">Generated ${escHtml(generated)}</span>
    </div>
  </div>
  <div class="summary">
    <div class="card"><div class="label">Orders</div><div class="value">${invoiceTotals.orderCount}</div></div>
    <div class="card"><div class="label">Pick &amp; Pack</div><div class="value">${money(invoiceTotals.pickPackTotal)}</div></div>
    <div class="card"><div class="label">Add'l Units</div><div class="value">${moneyOrDash(invoiceTotals.additionalTotal)}</div></div>
    <div class="card"><div class="label">Packages</div><div class="value">${moneyOrDash(invoiceTotals.packageTotal)}</div></div>
    <div class="card"><div class="label">Shipping</div><div class="value">${moneyOrDash(invoiceTotals.shippingTotal)}</div></div>
    <div class="card"><div class="label">Storage</div><div class="value">${moneyOrDash(invoiceTotals.storageTotal)}</div></div>
    <div class="card"><div class="label">Fulfillment Fee</div><div class="value">${money(invoiceTotals.grandTotal)}</div></div>
  </div>
  <div class="total"><span>Total Amount Due &mdash; ${periodFrom} &rarr; ${periodTo}</span><b>${money(invoiceTotals.grandTotal)}</b></div>
  ${truncNote}
  <table>
    <thead><tr>
      <th>Billing / Activity Date</th><th>Order #</th><th>SKU(s)</th><th class="num">Qty</th>
      <th class="num">Pick &amp; Pack</th><th class="num">Addl Units</th>
      <th class="num">Box Charge</th><th>Box Size</th><th class="num">Shipping</th>
      <th class="num">Storage</th><th class="num">Return Processing</th><th class="num">Return Postage</th>
      <th class="num">Fulfillment Fee</th>
    </tr></thead>
    <tbody>${detailRows || '<tr><td colspan="13">No billable order rows found for this period.</td></tr>'}</tbody>
    <tfoot>
      <tr>
        <td colspan="3">${invoiceTotals.orderCount} orders</td>
        <td class="num">${invoiceTotals.qty}</td>
        <td class="num">${money(invoiceTotals.pickPackTotal)}</td>
        <td class="num">${money(invoiceTotals.additionalTotal)}</td>
        <td class="num">${money(invoiceTotals.packageTotal)}</td>
        <td></td>
        <td class="num">${money(invoiceTotals.shippingTotal)}</td>
        <td class="num">${money(invoiceTotals.storageTotal)}</td>
        <td class="num">${money(invoiceTotals.returnProcessingTotal)}</td>
        <td class="num">${money(invoiceTotals.returnPostageTotal)}</td>
        <td class="num">${money(invoiceTotals.grandTotal)}</td>
      </tr>
    </tfoot>
  </table>
  <div class="footer">PrepShip invoice generated ${escHtml(generated)} for ${escHtml(clientName)}.</div>
</body>
</html>`;
}
