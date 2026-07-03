import { motion } from 'framer-motion';
import { Wallet, Boxes, TrendingUp, Lock } from 'lucide-react';
import { GlassPanel, SectionTitle } from '@/components/ui/Glass';
import { StatCard } from '@/components/ui/StatCard';
import { ProgressBar, Skeleton, EmptyState } from '@/components/ui/Display';
import { useReports } from '@/lib/hooks';
import { usePortalFilters } from '@/lib/portalContext';
import type { Accent } from '@/lib/accents';
import { staggerContainer } from '@/lib/motion';
import { money } from '@/lib/status';

const num = (v: unknown) => Number(v ?? 0) || 0;

export default function Finance() {
  const { days } = usePortalFilters();
  const query = useReports();
  const billingVisible = query.data?.billingVisible !== false;

  // CP-012: the charge breakdown, totals, billable-order count, and avg
  // cost/order are backend-owned (the /reports route computes them). Finance
  // renders those values — it no longer reduces the per-client rows. The accent
  // (a presentation-only concern) is mapped from the backend breakdown key.
  const ACCENT_BY_KEY: Record<string, Accent> = { pick_pack: 'indigo', package: 'amber', shipping: 'sky', storage: 'teal' };
  const charges = (query.data?.breakdown ?? []).map((b) => ({ label: b.label, amount: num(b.amount), accent: ACCENT_BY_KEY[b.key] ?? 'indigo' }));
  const totalCharges = num(query.data?.totalCharges ?? query.data?.grandTotal);
  const orders = num(query.data?.billableOrders);
  const avgCostPerOrder = num(query.data?.avgCostPerOrder);

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
            <StatCard label={`Charges (${days}d)`} value={money(totalCharges)} icon={Wallet} accent="amber" hint="Across all clients" />
            <StatCard label={`Billable orders (${days}d)`} value={orders.toLocaleString()} icon={Boxes} accent="indigo" />
            <StatCard label="Avg. cost / order" value={money(avgCostPerOrder)} icon={TrendingUp} accent="emerald" />
          </>
        )}
      </motion.div>

      <GlassPanel className="p-5">
        <SectionTitle title="Charges breakdown" subtitle={`Last ${days} days`} right={<span className="font-display text-lg font-bold text-ink tnum">{money(totalCharges)}</span>} />
        <div className="mt-5 space-y-4">
          {query.isLoading ? (
            <Skeleton className="h-40" />
          ) : totalCharges === 0 ? (
            <EmptyState icon={<Wallet size={24} />} title="No charges" message={`No billable activity in the last ${days} days.`} />
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
