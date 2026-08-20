import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, Boxes, DollarSign, Package, Inbox } from 'lucide-react';
import { Thumb } from '@/components/ui/Thumb';
import { GlassPanel, SectionTitle } from '@/components/ui/Glass';
import { StatCard } from '@/components/ui/StatCard';
import { Skeleton, EmptyState, Chip } from '@/components/ui/Display';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { QueryState } from '@/components/ui/QueryState';
import { Drawer } from '@/components/ui/Drawer';
import { Modal } from '@/components/ui/Modal';
import { TopSkuTrendChart } from '@/components/charts/Charts';
import { ChartDataTable } from '@/components/charts/ChartAccessibility';
import { Sparkline } from '@/components/charts/Sparkline';
import { OrderDetailLoader } from '@/components/OrderDetailLoader';
import { staggerContainer } from '@/lib/motion';
import { useAnalysis, useCanCustomizeTables, useSkuOrders } from '@/lib/hooks';
import { usePortalFilters } from '@/lib/portalContext';
import { money, shortDate, orderStatusMeta } from '@/lib/status';
import type { AnalysisOrderCombination, AnalysisSkuRow, SkuOrdersResult } from '@/lib/api';
import { CHART_THEME } from '@/lib/accents';

const num = (v: unknown) => Number(v ?? 0) || 0;
const TOP_N = 5;

export default function Analysis() {
  const { days } = usePortalFilters();
  const analysis = useAnalysis();
  const canCustomizeTables = useCanCustomizeTables();
  const loading = analysis.isLoading;
  // SKU drill-down panel + nested order-detail drill-down.
  const [selectedSku, setSelectedSku] = useState<AnalysisSkuRow | null>(null);
  const [detailOrderId, setDetailOrderId] = useState<number | null>(null);

  const rows = (analysis.data?.data ?? []) as AnalysisSkuRow[];
  const buckets = analysis.data?.dateBuckets ?? [];
  const orderCombinations = analysis.data?.orderCombinations ?? [];

  // CP-010: the Revenue/Units KPIs come from the backend-owned canonical
  // sales-metrics totals (the same owner the Dashboard uses), NOT from reducing
  // the SKU rows here. The per-SKU rows still roll up to these totals by
  // construction (identical filter set), but React no longer decides the
  // authoritative number, so Analysis and Dashboard can't drift.
  const totalUnits = Number(analysis.data?.totalUnits ?? 0);
  const totalRevenue = Number(analysis.data?.totalRevenue ?? 0);

  // Build the "Daily Units Sold — Top SKUs" multi-line series from the top SKUs.
  const { trendData, topSkus } = useMemo(() => {
    const top = [...rows].sort((a, b) => num(b.total_qty) - num(a.total_qty)).slice(0, TOP_N);
    const skus = top.map((r) => r.sku);
    const data = buckets.map((day, i) => {
      const point: Record<string, number | string> = { day: day.slice(5) };
      for (const r of top) point[r.sku] = r.daily_qty?.[i] ?? 0;
      return point;
    });
    return { trendData: data, topSkus: skus };
  }, [rows, buckets]);

  const columns: Column<AnalysisSkuRow>[] = [
    {
      key: 'name',
      header: 'Item Name',
      defaultWidth: 280,
      minWidth: 180,
      draggable: false, // "required" / anchor column
      render: (r) => (
        <div className="flex items-center gap-2.5">
          <Thumb src={r.image_url} alt={r.name ?? ''} size={32} iconSize={14} />
          <span className="block truncate text-ink" title={r.name ?? ''}>{r.name ?? '—'}</span>
        </div>
      ),
      sortAccessor: (r) => r.name ?? '',
    },
    { key: 'sku', header: 'SKU', defaultWidth: 130, render: (r) => <span className="font-semibold text-brand-700">{r.sku}</span>, sortAccessor: (r) => r.sku ?? '' },
    { key: 'client', header: 'Client', defaultWidth: 130, render: (r) => <span className="text-ink-3">{r.client_name ?? '—'}</span>, sortAccessor: (r) => r.client_name ?? '' },
    { key: 'orders', header: 'Orders', defaultWidth: 90, className: 'text-right', render: (r) => <span className="tnum font-medium text-ink">{num(r.orders)}</span>, sortAccessor: (r) => num(r.orders) },
    {
      key: 'pending',
      header: 'Pending',
      defaultWidth: 100,
      render: (r) => (num(r.pending) > 0 ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-600 tnum">{num(r.pending)} pend</span> : <span className="text-ink-3">—</span>),
      sortAccessor: (r) => num(r.pending),
    },
    // CP-011: the internal external-shipped classification (order shipped with
    // no local shipment row) is an operator/debug metric, not a customer-facing
    // one — its column was removed from the client Analysis table. The backend
    // may still compute ext_shipped internally; it just isn't surfaced here.
    { key: 'totalQty', header: 'Total Qty', defaultWidth: 100, className: 'text-right', render: (r) => <span className="tnum font-semibold text-ink">{num(r.total_qty)}</span>, sortAccessor: (r) => num(r.total_qty) },
    {
      key: 'trend',
      header: 'Units Trend',
      defaultWidth: 120,
      minWidth: 96,
      resizable: false,
      render: (r) => <Sparkline data={r.daily_qty ?? []} />,
    },
    {
      key: 'avgPrice',
      header: 'Avg Sell Price',
      defaultWidth: 120,
      className: 'text-right',
      render: (r) => {
        // CP-050 allowlisted presentation formula: backend total_revenue /
        // backend total_qty for the requested Analysis window. Backend owns
        // both canonical inputs; this formatted value is not a second SOT.
        const qty = num(r.total_qty);
        return <span className="tnum text-ink-2">{qty > 0 ? money(num(r.total_revenue) / qty) : '—'}</span>;
      },
      sortAccessor: (r) => (num(r.total_qty) > 0 ? num(r.total_revenue) / num(r.total_qty) : 0),
    },
    {
      key: 'revenue',
      header: 'Total Revenue',
      defaultWidth: 130,
      className: 'text-right',
      render: (r) => (
        <span className="tnum font-semibold text-ink">{money(num(r.total_revenue))}</span>
      ),
      sortAccessor: (r) => num(r.total_revenue),
    },
    // CP-035: Std ship, Exp ship, Selling Fees, and Profit are internal
    // financial/ship metrics DJ removed from the CUSTOMER Analysis view. The
    // backend may still compute std/exp/selling-fee fields for admin/operator
    // use; they are simply never surfaced as customer-facing columns here. (No
    // frontend Profit derivation either — that computed column is gone.)
    // CP-047: the customer Analysis API also drops those internal fields, so
    // hiding a column is not the security boundary.
  ];

  if (analysis.isError) {
    return (
      <GlassPanel className="p-4 sm:p-5">
        <QueryState
          isLoading={false}
          isError
          onRetry={() => analysis.refetch()}
        >
          <></>
        </QueryState>
      </GlassPanel>
    );
  }

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <motion.div variants={staggerContainer} initial="initial" animate="enter" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[148px] rounded-glass" />)
        ) : (
          <>
            <StatCard label="Active SKUs" value={Number(analysis.data?.totalSkus ?? rows.length).toLocaleString()} icon={Boxes} accent="teal" />
            <StatCard label={`Orders (${days}d)`} value={Number(analysis.data?.totalOrders ?? 0).toLocaleString()} icon={TrendingUp} accent="indigo" />
            <StatCard label={`Units sold (${days}d)`} value={totalUnits.toLocaleString()} icon={Package} accent="amber" />
            <StatCard label={`Revenue (${days}d)`} value={money(totalRevenue)} icon={DollarSign} accent="emerald" hint="Visible if permitted" />
          </>
        )}
      </motion.div>

      {/* Daily Units Sold — Top SKUs */}
      <GlassPanel className="p-5">
        <SectionTitle title="Daily Units Sold — Top SKUs" subtitle={`Units per day for the top ${TOP_N} SKUs (last ${days} days)`} />
        <div className="mt-4">
          {loading ? (
            <Skeleton className="h-[260px]" />
          ) : topSkus.length ? (
            <TopSkuTrendChart data={trendData} skus={topSkus} />
          ) : (
            <EmptyState
              icon={<Inbox size={24} />}
              title="No sales data"
              message="No SKU activity in this period."
            />
          )}
        </div>
      </GlassPanel>

      {/* SKU breakdown table */}
      <GlassPanel className="p-2 sm:p-3">
        {loading ? (
          <div className="p-4"><Skeleton className="h-64" /></div>
        ) : (
          <DataTable
            tableId="analysis"
            columns={columns}
            rows={rows}
            rowKey={(r) => `${r.sku}-${r.client_id ?? ''}`}
            onRowClick={(r) => r.inv_sku_id != null && setSelectedSku(r)}
            rowActionLabel={(r) => `View SKU details for ${r.sku}`}
            allowColumnCustomization={canCustomizeTables}
            empty={<EmptyState icon={<Inbox size={24} />} title="No analytics yet" message="SKU analytics will appear here once orders are synced." />}
            stickyHeader
          />
        )}
      </GlassPanel>

      {/* Order combinations */}
      <GlassPanel className="p-5">
        <SectionTitle title="Order combinations" subtitle={`Sold order mixes (${days}d)`} />
        <div className="mt-4">
          {loading ? (
            <Skeleton className="h-48" />
          ) : orderCombinations.length ? (
            <OrderCombinationsTable rows={orderCombinations} canCustomizeTables={canCustomizeTables} />
          ) : (
            <EmptyState icon={<Inbox size={24} />} title="No combinations yet" message="Order combinations will appear here once orders are synced." />
          )}
        </div>
      </GlassPanel>

      {/* SKU drill-down panel */}
      <Drawer open={!!selectedSku} onClose={() => setSelectedSku(null)} title={selectedSku?.name ?? selectedSku?.sku ?? 'SKU detail'} width={560}>
        {selectedSku && <SkuPanel row={selectedSku} onOpenOrder={setDetailOrderId} />}
      </Drawer>

      {/* Order detail — centered modal (opened from a SKU's recent orders) */}
      <Modal open={detailOrderId != null} onClose={() => setDetailOrderId(null)} title="Order detail">
        {detailOrderId != null && <OrderDetailLoader id={detailOrderId} />}
      </Modal>
    </div>
  );
}

function OrderCombinationsTable({ rows, canCustomizeTables }: { rows: AnalysisOrderCombination[]; canCustomizeTables: boolean }) {
  const columns: Column<AnalysisOrderCombination>[] = useMemo(
    () => [
      {
        key: 'combination',
        header: 'Combination',
        defaultWidth: 420,
        minWidth: 240,
        render: (row) => (
          <div>
            <p className="font-semibold text-ink">{row.label}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {row.items.map((item) => (
                <span
                  key={`${row.combinationKey}-${item.sku}`}
                  className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-ink-3 ring-1 ring-slate-200"
                  title={item.sku}
                >
                  {item.quantity > 1 ? `${item.quantity}x ` : ''}{item.sku}
                </span>
              ))}
            </div>
          </div>
        ),
      },
      {
        key: 'orders',
        header: 'Orders',
        defaultWidth: 110,
        className: 'text-right',
        render: (row) => <span className="tnum font-semibold text-ink">{num(row.orderCount).toLocaleString()}</span>,
      },
      {
        key: 'units',
        header: 'Units',
        defaultWidth: 110,
        className: 'text-right',
        render: (row) => <span className="tnum text-ink-2">{num(row.totalUnits).toLocaleString()}</span>,
      },
    ],
    [],
  );

  return (
    <DataTable
      tableId="analysis-order-combinations"
      columns={columns}
      rows={rows}
      rowKey={(row) => row.combinationKey}
      allowColumnCustomization={canCustomizeTables}
      stickyHeader
    />
  );
}

// Explicit money-state captions for orders whose shipping cannot be shown as a
// number. attributed/partial with a positive total render the money instead.
const SHIPPING_STATE_LABELS: Partial<Record<string, string>> = {
  unbilled: 'unbilled',
  external_label: 'external label',
  voided_only: 'label voided',
  unattributed_legacy: 'legacy billing',
};

function SkuStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
      <p className="truncate text-[10px] font-bold uppercase tracking-wider text-ink-3">{label}</p>
      <p className="mt-1 truncate text-lg font-bold text-ink tnum" title={value}>{value}</p>
    </div>
  );
}

function SkuPanel({ row, onOpenOrder }: { row: AnalysisSkuRow; onOpenOrder: (id: number) => void }) {
  const q = useSkuOrders(row.inv_sku_id ?? null);
  const data = q.data as SkuOrdersResult | undefined;
  const chart = useMemo(() => (data?.dailySales ?? []).map((d) => ({ day: d.day.slice(5), units: d.units })), [data]);

  if (q.isLoading) {
    return <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-44" /><Skeleton className="h-48" /></div>;
  }
  if (q.isError) {
    return (
      <QueryState isLoading={false} isError onRetry={() => q.refetch()}>
        <></>
      </QueryState>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-xs text-ink-3">{data?.sku ?? row.sku}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SkuStat label="30-day units" value={String(data?.totalUnits ?? 0)} />
        <SkuStat label="Avg std shipping" value={money(Number(data?.avgShippingStandard ?? 0))} />
        <SkuStat label="Avg expedited" value={money(Number(data?.avgShippingExpedited ?? 0))} />
        <SkuStat label="Avg / day" value={(data?.averageUnitsPerDay ?? 0).toFixed(1)} />
      </div>

      {/* Units-sold bar chart */}
      <div className="rounded-glass-sm bg-white/60 p-4 ring-1 ring-slate-200/70">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-3">Units sold — last 30 days</p>
        {chart.length ? (
          <figure aria-label="Units sold for selected SKU">
            <ResponsiveContainer width="100%" height={160}>
              <BarChart
                data={chart}
                accessibilityLayer
                margin={{ top: 8, right: 4, left: -24, bottom: 0 }}
              >
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 10, fill: CHART_THEME.axis }}
                  interval="preserveStartEnd"
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ fill: 'rgb(var(--brand-rgb) / 0.06)' }}
                  contentStyle={{
                    borderRadius: 12,
                    border: `1px solid ${CHART_THEME.tooltipBorder}`,
                    background: CHART_THEME.tooltipBackground,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="units" fill={CHART_THEME.brand} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <ChartDataTable
              title="Units sold for selected SKU"
              rows={chart}
              columns={[
                { key: 'day', label: 'Day', render: (point) => point.day },
                { key: 'units', label: 'Units', render: (point) => point.units.toLocaleString() },
              ]}
            />
          </figure>
        ) : (
          <p className="py-6 text-center text-sm text-ink-3">No sales in this window.</p>
        )}
      </div>

      {/* Recent orders */}
      <div className="rounded-glass-sm bg-white/60 p-4 ring-1 ring-slate-200/70">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-3">Recent orders ({data?.orders.length ?? 0})</p>
        <div className="space-y-1.5">
          {(data?.orders ?? []).length === 0 && <p className="text-sm text-ink-3">No orders.</p>}
          {(data?.orders ?? []).slice(0, 40).map((o) => {
            const meta = orderStatusMeta(o.order_status);
            return (
              <button
                key={`${o.order_id}-${o.order_number}`}
                onClick={() => onOpenOrder(o.order_id)}
                className="focus-ring flex w-full items-center gap-3 rounded-glass-sm px-2 py-2 text-left transition-colors hover:bg-brand-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-brand-700">{o.order_number}</p>
                  <p className="truncate text-xs text-ink-3">{o.ship_to_name ?? '—'} · {shortDate(o.order_date)}</p>
                </div>
                <span className="shrink-0 tnum text-xs text-ink-3">×{o.qty}</span>
                {o.shippingTotal && Number(o.shippingTotal) > 0 ? (
                  <span className="shrink-0 text-right">
                    <span className="tnum text-xs font-medium text-ink-2">{money(Number(o.shippingTotal))}</span>
                    {Number(o.shippingStandard ?? 0) > 0 && Number(o.shippingExpedited ?? 0) > 0 && (
                      <span className="block tnum text-[10px] text-ink-3">
                        std {money(Number(o.shippingStandard))} · exp {money(Number(o.shippingExpedited))}
                      </span>
                    )}
                  </span>
                ) : (
                  SHIPPING_STATE_LABELS[o.shippingMoneyState] ? (
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-3">
                      {SHIPPING_STATE_LABELS[o.shippingMoneyState]}
                    </span>
                  ) : null
                )}
                <Chip accent={meta.accent} dot={false}>{meta.label}</Chip>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
