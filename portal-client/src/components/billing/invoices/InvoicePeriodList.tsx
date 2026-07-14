import { FileSpreadsheet, Loader2 } from 'lucide-react';
import { DataTable } from '@/components/ui/DataTable';
import { GlassPanel } from '@/components/ui/Glass';
import { QueryState } from '@/components/ui/QueryState';
import { cn } from '@/lib/cn';
import type { PortalClientRow } from '@/lib/api';
import {
  buildSummaryColumns,
  invoiceActionButtonClass,
  periodLabel,
  type BillingTotals,
  type PeriodSummary,
} from '../invoiceColumns';
import type { InvoiceSelection } from './types';

interface InvoicePeriodListProps {
  clients: PortalClientRow[];
  clientFilter: number | undefined;
  granularity: 'half' | 'month';
  summary: PeriodSummary[];
  totals: BillingTotals;
  from: string;
  to: string;
  exporting: string | null;
  opening: string | null;
  canCustomizeTables: boolean;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  onClientFilterChange: (clientId: number | undefined) => void;
  onGranularityChange: (granularity: 'half' | 'month') => void;
  onSelect: (selection: InvoiceSelection) => void;
  onExportAll: () => void;
  onExport: (row: PeriodSummary, busyKey: string) => void;
  onView: (row: PeriodSummary, busyKey: string) => void;
}

export function InvoicePeriodList(props: InvoicePeriodListProps) {
  const summaryColumns = buildSummaryColumns({
    totals: props.totals,
    exporting: props.exporting,
    opening: props.opening,
    onExport: props.onExport,
    onView: props.onView,
  });

  return (
    <GlassPanel className="p-2 sm:p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-2">
        <p className="text-sm font-bold text-ink">Billing periods</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {props.clients.length > 1 && (
            <select
              value={props.clientFilter ?? ''}
              onChange={(event) => props.onClientFilterChange(
                event.target.value ? Number(event.target.value) : undefined,
              )}
              aria-label="Filter billing periods by client"
              className={cn(
                'focus-ring mr-1.5 h-11 cursor-pointer appearance-none rounded-glass-sm',
                'border border-white/80 bg-white/60 px-2.5 pr-7 text-xs font-medium text-ink',
                'ring-1 ring-slate-200/70 focus:bg-white/90 sm:h-8',
              )}
            >
              <option value="">All clients</option>
              {props.clients.map((client) => (
                <option key={client.id} value={client.id}>{client.name ?? `Client ${client.id}`}</option>
              ))}
            </select>
          )}
          {([['half', 'Semi-Monthly'], ['month', 'Monthly']] as const).map(([value, label]) => (
            <button
              type="button"
              key={value}
              onClick={() => props.onGranularityChange(value)}
              className={cn(
                'focus-ring min-h-11 cursor-pointer rounded-glass-sm px-3 py-1.5 text-xs font-semibold transition-colors sm:min-h-8',
                props.granularity === value
                  ? 'bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-glass'
                  : 'bg-white/60 text-ink-2 ring-1 ring-slate-200/70 hover:bg-white',
              )}
            >
              {label}
            </button>
          ))}
          <div className="mx-0.5 h-5 w-px bg-slate-200" aria-hidden />
          <button
            type="button"
            onClick={props.onExportAll}
            disabled={props.exporting != null || props.summary.length === 0}
            className={invoiceActionButtonClass}
            title={`Download every billing period from ${props.from} to ${props.to} in one Excel (.xlsx)`}
          >
            {props.exporting === 'all-periods'
              ? <Loader2 size={13} className="animate-spin" />
              : <FileSpreadsheet size={13} />}
            Export all
          </button>
        </div>
      </div>
      <QueryState
        isLoading={props.isLoading}
        isError={props.isError}
        error={props.error}
        isEmpty={props.summary.length === 0}
        onRetry={props.onRetry}
        emptyTitle="No billing available"
        emptyMessage="There are no billing periods available for this date range."
      >
        <DataTable
          tableId="invoices-summary"
          columns={summaryColumns}
          rows={props.summary}
          rowKey={(row) => `${row.clientId}-${row.periodStart}`}
          allowColumnCustomization={props.canCustomizeTables}
          onRowClick={(row) => props.onSelect({
            clientId: row.clientId,
            clientName: row.clientName,
            from: row.periodStart,
            to: row.periodEnd,
          })}
          rowActionLabel={(row) =>
            `View billing details for ${row.clientName}, ${periodLabel(row.periodStart, row.periodEnd)}`}
          defaultSort={{ key: 'period', dir: 'desc' }}
        />
      </QueryState>
    </GlassPanel>
  );
}
