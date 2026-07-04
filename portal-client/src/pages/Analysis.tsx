import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, Boxes, DollarSign, Package, Inbox } from 'lucide-react';
import { Thumb } from '@/components/ui/Thumb';
import { GlassPanel, SectionTitle } from '@/components/ui/Glass';
import { StatCard } from '@/components/ui/StatCard';
import { Skeleton, EmptyState, Chip, Tooltip as InfoTooltip } from '@/components/ui/Display';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Drawer } from '@/components/ui/Drawer';
import { Modal } from '@/components/ui/Modal';
import { TopSkuTrendChart } from '@/components/charts/Charts';
import { Sparkline } from '@/components/charts/Sparkline';
import { OrderDetailLoader } from '@/components/OrderDetailLoader';
import { staggerContainer } from '@/lib/motion';
import { useAnalysis, useSkuOrders } from '@/lib/hooks';
import { usePortalFilters } from '@/lib/portalContext';
import { money, shortDate, orderStatusMeta } from '@/lib/status';
import type { AnalysisSkuRow, SkuOrdersResult } from '@/lib/api';
import { cn } from '@/lib/cn';

const num = (v: unknown) => Number(v ?? 0) || 0;
const TOP_N = 5;
// CP-020: the Std/Exp columns show a cost-gated shipment COUNT paired with its
// matching-predicate allocated-shipping-cost DOLLAR — disclosed honestly.
const SHIP_BUCKET_TOOLTIP =
  'Excludes external, pending-label, and costless rows — so Std + Exp will read lower than Orders. ' +
  'Counts only shipments that carry a billed carrier label of this class. ' +
  'The $ is allocated shipping COST (the carrier label cost apportioned per unit), not revenue.';

export default function Analysis() {
  const { days } = usePortalFilters();
  const analysis = useAnalysis();
  const loading = analysis.isLoading;
  // SKU drill-down panel + nested order-detail drill-down.
  const [selectedSku, setSelectedSku] = useState<AnalysisSkuRow | null>(null);
  const [detailOrderId, setDetailOrderId] = useState<number | null>(null);

  const rows = (analysis.data?.data ?? []) as AnalysisSkuRow[];
  const buckets = analysis.data?.dateBuckets ?? [];

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
        const qty = num(r.total_qty);
        return <span className="tnum text-ink-2">{qty > 0 ? money(num(r.total_revenue) / qty) : '—'}</span>;
      },
      sortAccessor: (r) => (num(r.total_qty) > 0 ? num(r.total_revenue) / num(r.total_qty) : 0),
    },
    { key: 'revenue', header: 'Total Revenue', defaultWidth: 130, className: 'text-right', render: (r) => <span className="tnum font-semibold text-ink">{money(num(r.total_revenue))}</span>, sortAccessor: (r) => num(r.total_revenue) },
    {
      key: 'std',
      header: 'Std ship',
      defaultWidth: 120,
      className: 'text-right',
      render: (r) => (
        <InfoTooltip side="top" multiline label={SHIP_BUCKET_TOOLTIP}>
          <span tabIndex={0} className="tnum text-ink-2 cursor-help">
            {num(r.std_ship_count)}
            {num(r.std_total) > 0 && <span className="ml-1 text-xs text-emerald-600">{money(num(r.std_total))}</span>}
          </span>
        </InfoTooltip>
      ),
      sortAccessor: (r) => num(r.std_ship_count),
    },
    {
      key: 'exp',
      header: 'Exp ship',
      defaultWidth: 120,
      className: 'text-right',
      render: (r) => (
        <InfoTooltip side="top" multiline label={SHIP_BUCKET_TOOLTIP}>
          <span tabIndex={0} className="tnum text-ink-2 cursor-help">
            {num(r.exp_ship_count)}
            {num(r.exp_total) > 0 && <span className="ml-1 text-xs text-amber-600">{money(num(r.exp_total))}</span>}
          </span>
        </InfoTooltip>
      ),
      sortAccessor: (r) => num(r.exp_ship_count),
    },
    { key: 'shipping', header: 'Total Shipping', defaultWidth: 130, className: 'text-right', render: (r) => <span className="tnum text-ink-2">{money(num(r.total_shipping))}</span>, sortAccessor: (r) => num(r.total_shipping) },
    { key: 'fees', header: 'Selling Fees', defaultWidth: 120, className: 'text-right', render: (r) => <span className="tnum text-ink-2">{money(num(r.total_selling_fee))}</span>, sortAccessor: (r) => num(r.total_selling_fee) },
    {
      key: 'profit',
      header: 'Profit',
      defaultWidth: 120,
      className: 'text-right',
      render: (r) => {
        const profit = num(r.total_revenue) - num(r.total_shipping) - num(r.total_selling_fee);
        return <span className={cn('tnum font-semibold', profit >= 0 ? 'text-emerald-600' : 'text-rose-600')}>{money(profit)}</span>;
      },
      sortAccessor: (r) => num(r.total_revenue) - num(r.total_shipping) - num(r.total_selling_fee),
    },
  ];

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
          {loading ? <Skeleton className="h-[260px]" /> : topSkus.length ? <TopSkuTrendChart data={trendData} skus={topSkus} /> : <EmptyState icon={<Inbox size={24} />} title="No sales data" message="No SKU activity in this period." />}
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
            empty={<EmptyState icon={<Inbox size={24} />} title="No analytics yet" message="SKU analytics will appear here once orders are synced." />}
          />
        )}
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
  const avgPerDay = data && data.dailySales.length ? (data.totalUnits / data.dailySales.length) : 0;

  if (q.isLoading) {
    return <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-44" /><Skeleton className="h-48" /></div>;
  }
  if (q.isError) return <p className="text-sm text-ink-3">Couldn’t load this SKU’s orders.</p>;

  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-xs text-ink-3">{data?.sku ?? row.sku}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <SkuStat label="30-day units" value={String(data?.totalUnits ?? 0)} />
        <SkuStat label="Avg ship cost" value={money(Number(data?.avgStandardShippingCost ?? 0))} />
        <SkuStat label="Avg / day" value={avgPerDay.toFixed(1)} />
      </div>

      {/* Units-sold bar chart */}
      <div className="rounded-glass-sm bg-white/60 p-4 ring-1 ring-slate-200/70">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-3">Units sold — last 30 days</p>
        {chart.length ? (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chart} accessibilityLayer={false} margin={{ top: 8, right: 4, left: -24, bottom: 0 }}>
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#94a3b8' }} interval="preserveStartEnd" tickLine={false} axisLine={false} />
              <Tooltip cursor={{ fill: 'rgba(3,169,244,0.06)' }} contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }} />
              <Bar dataKey="units" fill="#03A9F4" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
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
                {o.standard_shipping_cost && Number(o.standard_shipping_cost) > 0 && (
                  <span className="shrink-0 tnum text-xs font-medium text-ink-2">{money(Number(o.standard_shipping_cost))}</span>
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
