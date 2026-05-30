import { Link } from 'react-router-dom';
import { Tags, ReceiptText, Info } from 'lucide-react';
import { GlassPanel, SectionTitle } from '@/components/ui/Glass';
import { AnimatedIcon } from '@/components/ui/AnimatedIcon';
import { Button } from '@/components/ui/Button';

/**
 * Rate Sheet.
 *
 * Storage / pick-pack / zone pricing is a contracted, operator-managed rate
 * sheet that the client-portal API does not (yet) expose as a live endpoint.
 * Rather than display fabricated numbers, this page shows an honest state and
 * points to the real billing detail in Invoices. Wire this to a real
 * `/api/client-portal/rate-sheet` endpoint once it exists.
 */
export default function Rates() {
  return (
    <div className="space-y-4">
      <GlassPanel className="p-4">
        <SectionTitle title="Rate sheet" subtitle="Your contracted PrepShip service pricing" />
      </GlassPanel>

      <GlassPanel className="p-8">
        <div className="mx-auto flex max-w-md flex-col items-center text-center">
          <AnimatedIcon icon={Tags} accent="amber" tile />
          <h3 className="mt-4 font-display text-lg font-semibold text-ink">Your rate sheet is managed by your operator</h3>
          <p className="mt-2 text-sm text-ink-3">
            Contracted storage, pick &amp; pack, and shipping rates aren’t published to the
            portal yet. Your actual billed charges — at your negotiated rates — are always
            available in Invoices.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Link to="/invoices"><Button leadingIcon={<ReceiptText size={16} />}>View invoices</Button></Link>
            <Link to="/finance"><Button variant="secondary">Open Finance</Button></Link>
          </div>
          <p className="mt-4 flex items-center gap-1.5 text-xs text-ink-3">
            <Info size={13} /> Contact your PrepShip account manager for a copy of your rate sheet.
          </p>
        </div>
      </GlassPanel>
    </div>
  );
}
