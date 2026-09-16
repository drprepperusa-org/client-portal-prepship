import { Link } from 'react-router-dom';
import { RefreshCw, ReceiptText } from 'lucide-react';
import { GlassPanel, SectionTitle } from '@/components/ui/Glass';
import { Button } from '@/components/ui/Button';
import { QueryState } from '@/components/ui/QueryState';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { useCanCustomizeTables, useMe, useRateSheet } from '@/lib/hooks';
import type { PortalRateSheet } from '@/lib/api';
import { shortDate } from '@/lib/status';

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });
const statusLabels = { configured: 'Configured', inactive: 'Billing inactive', not_configured: 'Services not configured' };

const packageColumns: Column<PortalRateSheet['packages'][number]>[] = [
  { key: 'box', header: 'Box', render: (box) => <div className="min-w-0">
    <span className="break-words font-medium">{box.name}</span>
    <span className="block text-xs text-ink-3">{box.dimensions ?? 'Dimensions not recorded'}</span>
  </div> },
  { key: 'price', header: 'Configured price / box', render: (box) => currency.format(Number(box.configuredPrice)) },
  { key: 'updated', header: 'Updated', render: (box) => shortDate(box.updatedAt) },
];

export default function Rates() {
  const me = useMe();
  const canView = Boolean(me.data?.canViewFinancials);
  const query = useRateSheet(canView);
  const rows = query.data?.data ?? [];
  return (
    <div className="space-y-4">
      <GlassPanel className="flex flex-wrap items-center justify-between gap-3 p-4">
        <SectionTitle title="Rate sheet" subtitle="Current configured PrepShip service pricing · USD" />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" leadingIcon={<RefreshCw size={16} />} disabled={!canView || query.isFetching}
            onClick={() => void query.refetch()}>Refresh rates</Button>
          <Link to="/invoices"><Button leadingIcon={<ReceiptText size={16} />}>View invoices</Button></Link>
        </div>
      </GlassPanel>
      <GlassPanel className="p-4 text-sm text-ink-3">
        These are the current saved rates for the selected client, regardless of the date filter.
        Invoice charges may include shipment-specific adjustments. Contact your account manager to change your rates.
      </GlassPanel>
      <QueryState isLoading={me.isLoading || (canView && query.isLoading)}
        isError={me.isError || (canView && query.isError)} isUpdating={canView && query.isFetching && !query.isLoading}
        onRetry={() => void (me.isError ? me.refetch() : query.refetch())}
        isEmpty={canView && rows.length === 0} emptyTitle="No rate sheets for this client selection"
        emptyMessage="Choose another client or ask your account manager to check your access.">
        {canView ? (
          <div className="space-y-4">{rows.map((row) => <ClientRates key={row.clientId} sheet={row} />)}</div>
        ) : (
          <GlassPanel className="p-6">
            <h2 className="font-semibold text-ink">Financial access required</h2>
            <p className="mt-2 text-sm text-ink-3">Ask your account manager for permission to view your rate sheet.</p>
          </GlassPanel>
        )}
      </QueryState>
    </div>
  );
}

function ServiceRate({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="min-w-0 rounded-glass-sm bg-slate-50 p-4 ring-1 ring-slate-200/70">
      <dt className="text-sm text-ink-3">{label}</dt>
      <dd className="mt-1 text-xl font-semibold text-ink tnum"><span>{currency.format(Number(value))}</span>
        <span className="mt-1 block text-xs font-normal text-ink-3">{unit}</span>
      </dd>
    </div>
  );
}

function ClientRates({ sheet }: { sheet: PortalRateSheet }) {
  const service = sheet.services;
  const canCustomizeTables = useCanCustomizeTables();
  return (
    <GlassPanel className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">{sheet.clientName}</h2>
          <p className="mt-1 text-xs text-ink-3">
            {service ? `Service rates updated ${shortDate(service.updatedAt)}` : 'Service rates have not been configured.'}
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-ink-2">
          {statusLabels[sheet.configurationStatus]}
        </span>
      </div>
      {sheet.configurationStatus === 'inactive' && (
        <p className="rounded-glass-sm bg-amber-50 p-3 text-sm text-amber-800">
          Billing is inactive for this client. The saved rates below are shown for reference.
        </p>
      )}
      {service ? (
        <dl className="grid gap-3 sm:grid-cols-3">
          <ServiceRate label="Pick & pack" value={service.pickPackFee}
            unit={`Includes up to ${service.includedUnits} ${service.includedUnits === 1 ? 'unit' : 'units'}`} />
          <ServiceRate label="Additional units" value={service.additionalUnitFee} unit="Per unit above the included quantity" />
          <ServiceRate label="Storage" value={service.storageFeePerCuFt} unit="Per cubic foot per month" />
        </dl>
      ) : (
        <p className="rounded-glass-sm bg-slate-50 p-4 text-sm text-ink-3">
          Prep and storage rates are not configured. A missing rate does not mean the service is free.
        </p>
      )}
      <section aria-label={`Packaging rates for ${sheet.clientName}`} className="space-y-3">
        <div>
          <h3 className="font-semibold text-ink">Packaging</h3>
          <p className="mt-1 text-sm text-ink-3">Configured box prices before billing adjustments. Final charges appear on invoices.</p>
        </div>
        {sheet.packages.length ? (
          <DataTable columns={packageColumns} rows={sheet.packages} rowKey={(box) => String(box.packageId)}
            tableId={`portal-rates-packaging-${sheet.clientId}`} allowColumnCustomization={canCustomizeTables} />
        ) : <p className="rounded-glass-sm bg-slate-50 p-4 text-sm text-ink-3">No packaging prices configured for this client.</p>}
        <p className="text-xs text-ink-3">Only saved box prices are listed. An unlisted box has no published price here.</p>
      </section>
    </GlassPanel>
  );
}
