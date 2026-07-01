import type { portalInvoiceDetails } from './read-models/invoice-details';

/**
 * Printable invoice HTML renderer (extracted from routes/client-portal.ts).
 * Pure string rendering — the route stays responsible for scope/financial
 * gating, the client lookup, and computing the totals it passes in.
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
  grandTotal: number;
}

type InvoiceDetailRows = Awaited<ReturnType<typeof portalInvoiceDetails>>;

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
    .summary { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin: 22px 0; }
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
    table { width: 100%; border-collapse: collapse; }
    th { background: #f9fafb; color: #374151; text-transform: uppercase; font-size: 10px; letter-spacing: .06em; }
    td, th { border: 1px solid #e5e7eb; padding: 8px 10px; text-align: left; }
    .item-name { white-space: pre-line; }
    tbody tr:nth-child(even) { background: #fafafa; }
    .num { text-align: right; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #2563eb; }
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

export function renderPortalInvoiceHtml(input: {
  clientName: string | null;
  dateFrom: string;
  dateTo: string;
  invoiceTotals: InvoiceTotals;
  details: InvoiceDetailRows;
}): string {
  const { clientName, dateFrom, dateTo, invoiceTotals, details } = input;
  const money = (value: unknown) => `$${Number(value ?? 0).toFixed(2)}`;
  const fromDisplay = dateFrom.slice(0, 10);
  const toDisplay = dateTo.slice(0, 10);
  const generated = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const detailRows = details
    .map((detail) => `
      <tr>
        <td>${escHtml(detail.shipDate)}</td>
        <td class="mono">${escHtml(detail.orderNumber ?? detail.orderId ?? '')}</td>
        <td>${escHtml(detail.recipientName ?? '')}</td>
        <td class="item-name">${escHtml(detail.itemNames ?? '')}</td>
        <td class="num">${Number(detail.qty ?? 0)}</td>
        <td class="num">${money(detail.pickpackTotal)}</td>
        <td class="num">${Number(detail.additionalTotal ?? 0) > 0 ? money(detail.additionalTotal) : '-'}</td>
        <td class="num">${Number(detail.packageTotal ?? 0) > 0 ? money(detail.packageTotal) : '-'}</td>
        <td class="num">${Number(detail.shippingTotal ?? 0) > 0 ? money(detail.shippingTotal) : '-'}</td>
        <td class="num bold">${money(detail.rowTotal)}</td>
      </tr>`)
    .join('');
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PrepShip Invoice - ${escHtml(clientName)} - ${fromDisplay} to ${toDisplay}</title>
  <style>${invoicePrintStyles}</style>
</head>
<body>
  <div class="print-tip">To save as PDF: press <strong>Ctrl+P</strong>, then choose <strong>Save as PDF</strong>.</div>
  <div class="header">
    <div class="brand"><h1>PrepShip Invoice</h1><div class="muted">DR Prepper 3PL Services</div><div class="muted">Generated ${escHtml(generated)}</div></div>
    <div class="client"><strong>${escHtml(clientName)}</strong><span class="muted">${fromDisplay} to ${toDisplay}</span></div>
  </div>
  <div class="summary">
    <div class="card"><div class="label">Orders</div><div class="value">${invoiceTotals.orderCount}</div></div>
    <div class="card"><div class="label">Qty</div><div class="value">${invoiceTotals.qty}</div></div>
    <div class="card"><div class="label">Pick/pack</div><div class="value">${money(invoiceTotals.pickPackTotal)}</div></div>
    <div class="card"><div class="label">Box fee</div><div class="value">${money(invoiceTotals.packageTotal)}</div></div>
    <div class="card"><div class="label">Shipping</div><div class="value">${money(invoiceTotals.shippingTotal)}</div></div>
    <div class="card"><div class="label">Storage</div><div class="value">${money(invoiceTotals.storageTotal)}</div></div>
  </div>
  <div class="total"><span>Total amount due</span><b>${money(invoiceTotals.grandTotal)}</b></div>
  <table>
    <thead><tr>
      <th>Ship date</th><th>Order</th><th>Recipient</th><th>Item name</th><th class="num">Qty</th>
      <th class="num">Pick/pack</th><th class="num">Additional</th><th class="num">Box fee</th>
      <th class="num">Shipping</th><th class="num">Row total</th>
    </tr></thead>
    <tbody>${detailRows || '<tr><td colspan="10">No billable order rows found for this period.</td></tr>'}</tbody>
    <tfoot>
      <tr>
        <td colspan="5">${invoiceTotals.orderCount} orders / ${invoiceTotals.qty} qty</td>
        <td class="num">${money(invoiceTotals.pickPackTotal)}</td>
        <td class="num">${money(invoiceTotals.additionalTotal)}</td>
        <td class="num">${money(invoiceTotals.packageTotal)}</td>
        <td class="num">${money(invoiceTotals.shippingTotal)}</td>
        <td class="num">${money(invoiceTotals.grandTotal)}</td>
      </tr>
    </tfoot>
  </table>
  <div class="footer">PrepShip invoice generated ${escHtml(generated)} for ${escHtml(clientName)}.</div>
</body>
</html>`;
}
