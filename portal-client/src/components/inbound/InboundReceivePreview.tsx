import type { InboundReceivePreview as Preview } from '@client-portal-contracts/inbound-receive-preview';

const matches: Record<Preview['rows'][number]['inventoryMatch'], string> = {
  matched: 'Matched', missing: 'SKU not found', ambiguous: 'Multiple matches', no_sku: 'SKU missing', unassigned: 'Client not assigned',
};
const quantities = { short: 'Shortage', extra: 'Extra units', exact: 'As expected' };

export function InboundReceivePreview({ preview }: { preview: Preview }) {
  return <section aria-label="Receiving preview" className="min-w-0 space-y-3 rounded-glass-sm bg-slate-50 p-3 ring-1 ring-slate-200">
    <h3 className="font-semibold text-ink">Review before receiving</h3>
    <p className="text-sm text-ink-2">{preview.addToInventory
      ? 'Matched units below will be added to inventory when you confirm.' : 'This receipt will not add any units to inventory.'}</p>
    <dl className="grid grid-cols-3 gap-2 text-sm">
      <div><dt className="text-xs text-ink-3">Expected units</dt><dd className="font-semibold text-ink">{preview.expectedUnits.toLocaleString()}</dd></div>
      <div><dt className="text-xs text-ink-3">Entered units</dt><dd className="font-semibold text-ink">{preview.receivedUnits.toLocaleString()}</dd></div>
      <div><dt className="text-xs text-ink-3">Inventory additions</dt><dd className="font-semibold text-ink">{preview.inventoryUnits.toLocaleString()}</dd></div>
    </dl>
    {preview.issues.map(issue => <p key={issue} role="alert" className="text-sm text-rose-700">{issue}</p>)}
    <ul className="max-h-80 space-y-2 overflow-auto">
      {preview.rows.map(row => <li key={row.id} className="rounded-lg bg-white p-3 text-sm ring-1 ring-slate-200">
        <p className="break-words font-medium text-ink">{row.name ?? row.sku ?? 'Item'}{row.name && row.sku ? ` · ${row.sku}` : ''}</p>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-ink-2">
          <div><dt>Expected / entered</dt><dd>{row.expectedQty.toLocaleString()} / {row.receivedQty.toLocaleString()}</dd></div>
          <div><dt>Difference</dt><dd className={row.quantityStatus === 'exact' ? 'text-ink-2' : 'font-semibold text-amber-700'}>
            {row.difference > 0 ? '+' : ''}{row.difference.toLocaleString()} · {quantities[row.quantityStatus]}</dd></div>
          <div><dt>Inventory match</dt><dd>{matches[row.inventoryMatch]}</dd></div>
          <div><dt>Units to add</dt><dd>{row.inventoryUnits.toLocaleString()}</dd></div>
        </dl>
        {row.issue && <p className="mt-2 text-xs text-rose-700">{row.issue}</p>}
      </li>)}
    </ul>
    <p role="status" className={`text-sm font-medium ${preview.canConfirm ? 'text-emerald-700' : 'text-rose-700'}`}>
      {preview.canConfirm ? 'Ready to confirm. Nothing has been saved yet.' : 'Resolve the inventory matches, then preview again. Nothing has been saved.'}
    </p>
  </section>;
}
