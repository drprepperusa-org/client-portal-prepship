import { Link } from 'react-router-dom';
import { Building2, ReceiptText } from 'lucide-react';
import { SectionTitle, Divider } from '@/components/ui/Glass';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Display';
import { useClients } from '@/lib/hooks';

/* BILLING - point at the real Invoices/Finance data instead of a
   fabricated card + plan. Payment methods are operator-managed. */
export function BillingTab() {
  const clients = useClients().data?.data ?? [];

  return (
    <div className="space-y-5">
      <SectionTitle title="Billing" subtitle="Your invoices and billed client accounts" />
      <div className="space-y-2">
        {clients.length === 0 && <p className="text-sm text-ink-3">No billed accounts in scope.</p>}
        {clients.map((c) => (
          <div key={c.id} className="flex items-center gap-3 rounded-glass-sm bg-white/60 p-3 ring-1 ring-slate-200/70">
            <span className="grid h-10 w-10 place-items-center rounded-md bg-brand-50 text-brand-600"><Building2 size={18} /></span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{c.name ?? `Client ${c.id}`}</p>
              <p className="truncate text-xs text-ink-3">Billed account</p>
            </div>
            <Chip accent={c.active ? 'emerald' : 'amber'} dot={false}>{c.active ? 'Active' : 'Inactive'}</Chip>
          </div>
        ))}
      </div>
      <Divider />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-glass-sm bg-white/60 p-4 ring-1 ring-slate-200/70">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-md bg-brand-50 text-brand-600"><ReceiptText size={18} /></span>
          <div>
            <p className="text-sm font-semibold text-ink">Invoices & charges</p>
            <p className="text-xs text-ink-3">View your real billing detail and statements.</p>
          </div>
        </div>
        <Link to="/invoices"><Button variant="secondary" size="sm">Open Invoices</Button></Link>
      </div>
      <p className="text-xs text-ink-3">Payment methods and plan terms are managed by your PrepShip operator.</p>
    </div>
  );
}
