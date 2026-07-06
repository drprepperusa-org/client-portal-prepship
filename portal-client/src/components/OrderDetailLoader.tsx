import { useOrder } from '@/lib/hooks';
import { Skeleton } from '@/components/ui/Display';
import { OrderDetailPanel } from '@/components/OrderDetailPanel';

/**
 * CP-022 — the ONE canonical order-detail loader. Every entry point (Orders,
 * Analysis, and Shipments drawers) renders order detail through this: it fetches
 * the canonical GET /orders/:id DTO and renders it. The launching page's list
 * row only drives the table — it can never change the visible detail truth,
 * because the modal always re-reads the single backend-owned order DTO.
 */
export function OrderDetailLoader({
  id,
  hideWeight = false,
  hideWeightWhenShipped = false,
}: {
  id: number;
  hideWeight?: boolean;
  hideWeightWhenShipped?: boolean;
}) {
  const q = useOrder(id);
  if (q.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 rounded-glass-sm" />
        <Skeleton className="h-40 rounded-glass-sm" />
      </div>
    );
  }
  if (q.isError || !q.data?.data) {
    return <p className="text-sm text-ink-3">Couldn’t load this order.</p>;
  }
  return (
    <OrderDetailPanel
      o={q.data.data}
      hideWeight={hideWeight}
      hideWeightWhenShipped={hideWeightWhenShipped}
    />
  );
}
