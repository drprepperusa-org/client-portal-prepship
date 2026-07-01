import { useState } from 'react';
import { motion } from 'framer-motion';
import { Bell, Truck, AlertTriangle, ReceiptText, BarChart3, Check } from 'lucide-react';
import { SectionTitle, Divider } from '@/components/ui/Glass';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { LS_NOTIF, loadJSON } from './storage';

type NotifPrefs = { ship: boolean; lowStock: boolean; invoice: boolean; weekly: boolean };
const NOTIF_DEFAULTS: NotifPrefs = { ship: true, lowStock: true, invoice: true, weekly: false };
const NOTIF_OPTS: { key: keyof NotifPrefs; icon: typeof Bell; title: string; desc: string }[] = [
  { key: 'ship', icon: Truck, title: 'Shipment status updates', desc: 'When a shipment is created, picked up, in transit, or delivered.' },
  { key: 'lowStock', icon: AlertTriangle, title: 'Low-stock alerts', desc: 'When an SKU drops below its reorder threshold.' },
  { key: 'invoice', icon: ReceiptText, title: 'New invoice issued', desc: 'When a new invoice or statement becomes available.' },
  { key: 'weekly', icon: BarChart3, title: 'Weekly performance digest', desc: 'A summary of orders, spend, and trends every Monday.' },
];

export function NotificationsTab() {
  const toast = useToast();
  const [notif, setNotif] = useState<NotifPrefs>(() => loadJSON(LS_NOTIF, NOTIF_DEFAULTS));

  function saveNotif() {
    try {
      localStorage.setItem(LS_NOTIF, JSON.stringify(notif));
      toast.success('Preferences updated', 'Your notification choices are saved.');
    } catch {
      toast.error("Couldn't save", 'Local storage is unavailable in this browser.');
    }
  }

  return (
    <div className="space-y-5">
      <SectionTitle title="Notifications" subtitle="Choose what you want to hear about" />
      <div className="space-y-2.5">
        {NOTIF_OPTS.map((o) => {
          const on = notif[o.key];
          return (
            <button
              key={o.key}
              type="button"
              role="switch"
              aria-checked={on}
              onClick={() => setNotif((n) => ({ ...n, [o.key]: !n[o.key] }))}
              className={cn(
                'focus-ring flex w-full items-center gap-3.5 rounded-glass-sm border p-3.5 text-left transition-colors',
                on ? 'border-brand-200 bg-brand-50/50' : 'border-slate-200/70 bg-white/60 hover:bg-white',
              )}
            >
              <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-lg transition-colors', on ? 'bg-brand-100 text-brand-600' : 'bg-slate-100 text-ink-3')}>
                <o.icon size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{o.title}</p>
                <p className="text-xs text-ink-3">{o.desc}</p>
              </div>
              <span className={cn('relative h-6 w-11 shrink-0 rounded-full transition-colors', on ? 'bg-brand-500' : 'bg-slate-300')}>
                <motion.span
                  initial={false}
                  animate={{ left: on ? 22 : 2 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                  className="absolute top-0.5 grid h-5 w-5 place-items-center rounded-full bg-white shadow"
                >
                  {on && <Check size={12} strokeWidth={3.5} className="text-brand-500" />}
                </motion.span>
              </span>
            </button>
          );
        })}
      </div>
      <Divider />
      <div className="flex justify-end"><Button onClick={saveNotif}>Save preferences</Button></div>
    </div>
  );
}
