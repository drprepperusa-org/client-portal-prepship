import { motion } from 'framer-motion';
import { ShoppingCart, Truck, Boxes, Wallet, Inbox } from 'lucide-react';
import { GlassPanel, SectionTitle } from '@/components/ui/Glass';
import { StatCard } from '@/components/ui/StatCard';
import { Skeleton, EmptyState } from '@/components/ui/Display';
import { OrdersUnitsBarChart, VolumeBarChart } from '@/components/charts/Charts';
import { staggerContainer } from '@/lib/motion';
import { useDashboard, useDailyCounts, useDailyShipments, useAwaitingCount } from '@/lib/hooks';
import { usePortalFilters } from '@/lib/portalContext';
import { money } from '@/lib/status';

export default function Dashboard() {
  const { days } = usePortalFilters();
  const dash = useDashboard();
  const counts = useDailyCounts();
  const ships = useDailyShipments();
  const aw = useAwaitingCount();

  const loading = dash.isLoading || counts.isLoading || ships.isLoading || aw.isLoading;

  const countRows = counts.data?.data ?? [];
  // Open orders = current orders still awaiting shipment (a live state count,
  // NOT a 30-day window). Sourced from the same endpoint as the sidebar badge
  // so the two always agree; windowing it by order date dropped older unshipped
  // orders and made this read lower than the real backlog.
  const openOrders = aw.data?.count ?? 0;
  const shipped = countRows.reduce((n, r) => n + Number(r.shipped ?? 0), 0);

  // Orders vs. units per day, sourced from the single scoped /dashboard
  // response so the two bar segments are always aligned (same rows, same scope).
  const ordersUnitsSeries = (dash.data?.daily ?? []).map((d) => ({ day: d.day.slice(5), orders: d.orders, units: d.units }));
  const volumeSeries = (ships.data?.data ?? []).map((r) => ({ month: r.day.slice(5), vol: r.shipments }));
  const topSku = dash.data?.bySku?.[0]?.sku ?? '—';

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <motion.div variants={staggerContainer} initial="initial" animate="enter" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[148px] rounded-glass" />)
        ) : (
          <>
            <StatCard label="Open orders" value={openOrders.toLocaleString()} icon={ShoppingCart} accent="indigo" hint="Awaiting shipment" />
            <StatCard label={`Shipped (${days}d)`} value={shipped.toLocaleString()} icon={Truck} accent="teal" />
            <StatCard label={`Units shipped (${days}d)`} value={Number(dash.data?.units ?? 0).toLocaleString()} icon={Boxes} accent="amber" hint={`Top SKU: ${topSku}`} />
            <StatCard label={`Revenue (${days}d)`} value={money(dash.data?.revenue ?? 0)} icon={Wallet} accent="emerald" hint="Visible if permitted" />
          </>
        )}
      </motion.div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <GlassPanel className="p-5 lg:col-span-2">
          <SectionTitle title="Orders over time" subtitle={`Orders count vs. unit count (last ${days} days)`} />
          <div className="mt-4">
            {loading ? <Skeleton className="h-[260px]" /> : ordersUnitsSeries.length ? <OrdersUnitsBarChart data={ordersUnitsSeries} /> : <EmptyState icon={<Inbox size={24} />} title="No order activity" message="No orders in the selected period." />}
          </div>
        </GlassPanel>

        <GlassPanel className="p-5">
          <SectionTitle title="Shipment volume" subtitle="Daily shipments" />
          <div className="mt-4">
            {loading ? <Skeleton className="h-[260px]" /> : volumeSeries.length ? <VolumeBarChart data={volumeSeries} /> : <EmptyState icon={<Inbox size={24} />} title="No shipments" message="No shipments in the selected period." />}
          </div>
        </GlassPanel>
      </div>

      {/* Top SKUs */}
      <GlassPanel className="p-5">
        <SectionTitle title="Top SKUs" subtitle={`By units shipped (last ${days} days)`} />
        <div className="mt-4">
          {loading ? (
            <Skeleton className="h-40" />
          ) : (dash.data?.bySku?.length ?? 0) === 0 ? (
            <EmptyState icon={<Inbox size={24} />} title="No SKU data" message="SKU activity will appear here." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs font-medium uppercase tracking-wide text-ink-3">
                    <th className="py-2 pr-4">SKU</th>
                    <th className="py-2 px-4 text-right">Unit Count Last 30 Days</th>
                    <th className="py-2 pl-4 text-right">Avg Shipping Price</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dash.data!.bySku.slice(0, 8).map((s) => (
                    <tr key={s.sku}>
                      <td className="py-2.5 pr-4 font-medium text-ink-2">{s.sku}</td>
                      <td className="py-2.5 px-4 text-right tnum text-ink-3">{s.units30.toLocaleString()}</td>
                      <td className="py-2.5 pl-4 text-right tnum text-ink-3">
                        {s.avgShippingPrice == null ? '—' : money(s.avgShippingPrice)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </GlassPanel>
    </div>
  );
}
