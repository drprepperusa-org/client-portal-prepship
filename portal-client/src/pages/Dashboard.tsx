import { motion } from 'framer-motion';
import { ShoppingCart, Truck, Boxes, Wallet, Inbox } from 'lucide-react';
import { GlassPanel, SectionTitle } from '@/components/ui/Glass';
import { StatCard } from '@/components/ui/StatCard';
import { Skeleton, EmptyState } from '@/components/ui/Display';
import { OrdersAreaChart, VolumeBarChart } from '@/components/charts/Charts';
import { staggerContainer } from '@/lib/motion';
import { useDashboard, useDailyCounts, useDailyShipments } from '@/lib/hooks';
import { usePortalFilters } from '@/lib/portalContext';
import { money } from '@/lib/status';

export default function Dashboard() {
  const { days } = usePortalFilters();
  const dash = useDashboard();
  const counts = useDailyCounts();
  const ships = useDailyShipments();

  const loading = dash.isLoading || counts.isLoading || ships.isLoading;

  const countRows = counts.data?.data ?? [];
  const awaiting = countRows.reduce((n, r) => n + Number(r.awaiting ?? 0), 0);
  const shipped = countRows.reduce((n, r) => n + Number(r.shipped ?? 0), 0);

  const ordersSeries = countRows.map((r) => ({ day: r.day.slice(5), orders: r.total, shipped: r.shipped }));
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
            <StatCard label={`Open orders (${days}d)`} value={awaiting.toLocaleString()} icon={ShoppingCart} accent="indigo" hint="Awaiting shipment" />
            <StatCard label={`Shipped (${days}d)`} value={shipped.toLocaleString()} icon={Truck} accent="teal" />
            <StatCard label={`Units shipped (${days}d)`} value={Number(dash.data?.units ?? 0).toLocaleString()} icon={Boxes} accent="amber" hint={`Top SKU: ${topSku}`} />
            <StatCard label={`Revenue (${days}d)`} value={money(dash.data?.revenue ?? 0)} icon={Wallet} accent="emerald" hint="Visible if permitted" />
          </>
        )}
      </motion.div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <GlassPanel className="p-5 lg:col-span-2">
          <SectionTitle title="Orders over time" subtitle={`Orders received vs. shipped (last ${days} days)`} />
          <div className="mt-4">
            {loading ? <Skeleton className="h-[260px]" /> : ordersSeries.length ? <OrdersAreaChart data={ordersSeries} /> : <EmptyState icon={<Inbox size={24} />} title="No order activity" message="No orders in the selected period." />}
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
            <ul className="divide-y divide-slate-100">
              {dash.data!.bySku.slice(0, 8).map((s) => (
                <li key={s.sku} className="flex items-center justify-between py-2.5">
                  <span className="font-medium text-ink-2">{s.sku}</span>
                  <span className="tnum text-ink-3">{s.units30.toLocaleString()} units</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </GlassPanel>
    </div>
  );
}
