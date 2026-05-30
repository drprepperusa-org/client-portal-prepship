import { motion } from 'framer-motion';
import { Wallet, Boxes, TrendingUp, Lock } from 'lucide-react';
import { GlassPanel, SectionTitle } from '@/components/ui/Glass';
import { StatCard } from '@/components/ui/StatCard';
import { ProgressBar, Skeleton, EmptyState } from '@/components/ui/Display';
import { useReports } from '@/lib/hooks';
import type { Accent } from '@/lib/accents';
import { staggerContainer } from '@/lib/motion';
import { money } from '@/lib/status';

const num = (v: unknown) => Number(v ?? 0) || 0;

export default function Finance() {
  const query = useReports();
  const billingVisible = query.data?.billingVisible !== false;
  const rows = query.data?.data ?? query.data?.clients ?? [];

  const charges: { label: string; amount: number; accent: Accent }[] = [
    { label: 'Pick & Pack', amount: rows.reduce((n, r) => n + num(r.pickPackTotal ?? r.pickpackTotal), 0), accent: 'indigo' },
    { label: 'Box / Packaging', amount: rows.reduce((n, r) => n + num(r.packageTotal), 0), accent: 'amber' },
    { label: 'Shipping / Postage', amount: rows.reduce((n, r) => n + num(r.shippingTotal), 0), accent: 'sky' },
    { label: 'Storage', amount: rows.reduce((n, r) => n + num(r.storageTotal), 0), accent: 'teal' },
  ];
  const totalCharges = num(query.data?.grandTotal) || charges.reduce((n, c) => n + c.amount, 0);
  const orders = rows.reduce((n, r) => n + num(r.orderCount), 0);

  if (!billingVisible) {
    return (
      <GlassPanel className="p-5">
        <SectionTitle title="Finance" subtitle="Account charges & spend" />
        <EmptyState icon={<Lock size={24} />} title="Financials restricted" message="Your account doesn't have permission to view finance data." />
      </GlassPanel>
    );
  }

  return (
    <div className="space-y-4">
      <motion.div variants={staggerContainer} initial="initial" animate="enter" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {query.isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[148px] rounded-glass" />)
        ) : (
          <>
            <StatCard label="Charges (30d)" value={money(totalCharges)} icon={Wallet} accent="amber" hint="Across all clients" />
            <StatCard label="Billable orders (30d)" value={orders.toLocaleString()} icon={Boxes} accent="indigo" />
            <StatCard label="Avg. cost / order" value={money(orders ? totalCharges / orders : 0)} icon={TrendingUp} accent="emerald" />
          </>
        )}
      </motion.div>

      <GlassPanel className="p-5">
        <SectionTitle title="Charges breakdown" subtitle="Last 30 days" right={<span className="font-display text-lg font-bold text-ink tnum">{money(totalCharges)}</span>} />
        <div className="mt-5 space-y-4">
          {query.isLoading ? (
            <Skeleton className="h-40" />
          ) : totalCharges === 0 ? (
            <EmptyState icon={<Wallet size={24} />} title="No charges" message="No billable activity in the last 30 days." />
          ) : (
            charges.map((c) => (
              <div key={c.label}>
                <div className="mb-1.5 flex items-center justify-between text-sm">
                  <span className="text-ink-2">{c.label}</span>
                  <span className="font-semibold tnum text-ink">{money(c.amount)}</span>
                </div>
                <ProgressBar value={totalCharges ? (c.amount / totalCharges) * 100 : 0} accent={c.accent} />
              </div>
            ))
          )}
        </div>
      </GlassPanel>
    </div>
  );
}
