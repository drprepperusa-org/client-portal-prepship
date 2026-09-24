import { useState } from 'react';
import { Pagination } from '@/components/ui/Pagination';
import { INBOUND_IMPORT_COLUMNS, type InboundImportPreview } from '@client-portal-contracts/inbound-import';

const labels: Record<(typeof INBOUND_IMPORT_COLUMNS)[number], string> = {
  client: 'Client', reference: 'Reference / PO', supplier: 'Supplier', status: 'Status', expected_date: 'Expected date',
  carrier: 'Carrier', tracking: 'Tracking', sku: 'SKU', name: 'Item name', qty: 'Quantity',
};
export function InboundImportPreviewTable({ preview }: { preview: InboundImportPreview }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const rows = errorsOnly ? preview.rows.filter(row => row.errors.length) : preview.rows;
  return (
    <section aria-label="Import preview" className="min-w-0 space-y-2">
      <p role="status" className="text-sm font-semibold text-ink">
        {preview.shipmentCount} shipments · {preview.itemCount} item rows · {preview.valid ? 'Ready to import' : 'Correct the errors before importing'}
      </p>
      {!!preview.errors.length && <ul role="alert" className="list-inside list-disc text-sm text-rose-700">
        {preview.errors.map((error, i) => <li key={i}>{error}</li>)}
      </ul>}
      {!!preview.rows.length && <label className="flex items-center gap-2 text-sm text-ink-2">
        <input type="checkbox" checked={errorsOnly} onChange={event => { setErrorsOnly(event.target.checked); setPage(1); }} />
        Show rows with errors
      </label>}
      {!!rows.length && <div className="max-h-80 overflow-auto rounded-lg border border-slate-200" tabIndex={0} aria-label="CSV rows">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-slate-50 text-ink-2"><tr>
            <th scope="col" className="p-2">CSV row</th>
            {INBOUND_IMPORT_COLUMNS.map(column => <th scope="col" key={column} className="whitespace-nowrap p-2">{labels[column]}</th>)}
            <th scope="col" className="p-2">Review</th>
          </tr></thead>
          <tbody>{rows.slice((page - 1) * pageSize, page * pageSize).map(row => <tr key={row.line} className={row.errors.length ? 'border-t border-slate-200 bg-rose-50' : 'border-t border-slate-200'}>
            <th scope="row" className="p-2 font-semibold">{row.line}</th>
            {INBOUND_IMPORT_COLUMNS.map(column => <td key={column} className="max-w-48 whitespace-pre-wrap break-words p-2 text-ink-2">
              {column === 'client' ? row.clientName ?? row.values.client : row.values[column] || '—'}
            </td>)}
            <td className="min-w-48 p-2">{row.errors.length
              ? <ul className="list-inside list-disc text-rose-700">{row.errors.map((error, i) => <li key={i}>{error}</li>)}</ul>
              : <span className="text-emerald-700">Ready</span>}</td>
          </tr>)}</tbody>
        </table>
      </div>}
      <Pagination page={page} totalPages={Math.max(1, Math.ceil(rows.length / pageSize))} total={rows.length} pageSize={pageSize}
        onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1); }} />
    </section>
  );
}
