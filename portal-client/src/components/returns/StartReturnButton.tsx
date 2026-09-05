import { Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useOrder } from '@/lib/hooks';

// Fetches the same detail DTO as the drawer (React Query deduplicates it).
// Missing/loading policy is disabled; only the backend can grant eligibility.
export function StartReturnButton({ orderId, onStart }: { orderId: number; onStart: (id: number) => void }) {
  const order = useOrder(orderId);
  const eligibility = order.data?.data.returnEligibility;
  return (
    <div className="space-y-2">
      <Button variant="secondary" className="w-full" leadingIcon={<Undo2 size={16} />}
        disabled={eligibility?.allowed !== true} onClick={() => onStart(orderId)}>
        Start a return
      </Button>
      {eligibility?.allowed !== true && (
        <p className="text-sm text-ink-3" role="status">
          {order.isLoading ? 'Checking return eligibility…' : eligibility?.reason ?? 'Return eligibility is unavailable. Reload this order to try again.'}
        </p>
      )}
    </div>
  );
}
