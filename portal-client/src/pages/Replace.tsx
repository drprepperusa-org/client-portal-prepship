import { Link } from 'react-router-dom';
import { Repeat, Undo2, ShoppingCart, Info } from 'lucide-react';
import { GlassPanel, SectionTitle } from '@/components/ui/Glass';
import { AnimatedIcon } from '@/components/ui/AnimatedIcon';
import { Button } from '@/components/ui/Button';

/**
 * Replace.
 *
 * A replacement re-ships an item to the customer when the original arrived
 * damaged, incorrect, or never arrived — distinct from a Return, which only
 * brings stock back in. The client-portal API does not expose a replacement
 * resource yet (no schema, no `/api/client-portal/replacements` endpoint), so
 * this page states that plainly instead of rendering fabricated rows. Wire it
 * to a real endpoint once one exists, following `domains/returns.ts`.
 */
export default function Replace() {
  return (
    <div className="space-y-4">
      <GlassPanel className="p-4">
        <SectionTitle title="Replace" subtitle="Re-ship an item to your customer" />
      </GlassPanel>

      <GlassPanel className="p-6 sm:p-8">
        <div className="mx-auto flex max-w-md flex-col items-center text-center">
          <AnimatedIcon icon={Repeat} accent="emerald" tile />
          <h3 className="mt-4 font-display text-lg font-semibold text-ink">Replacements are on the way</h3>
          <p className="mt-2 text-sm text-ink-3">
            Replacement orders aren’t connected to the portal yet. In the meantime, if a
            customer received a damaged or incorrect item, log it as a return and place a
            new order for the replacement shipment.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Link to="/returns"><Button leadingIcon={<Undo2 size={16} />}>Open Returns</Button></Link>
            <Link to="/orders"><Button variant="secondary" leadingIcon={<ShoppingCart size={16} />}>View orders</Button></Link>
          </div>
          <p className="mt-4 flex items-center gap-1.5 text-xs text-ink-3">
            <Info size={13} /> Contact your PrepShip account manager to arrange a replacement today.
          </p>
        </div>
      </GlassPanel>
    </div>
  );
}
