import { useOrder } from '@/lib/hooks';
import { Skeleton } from '@/components/ui/Display';
import { OrderDetailPanel } from '@/components/OrderDetailPanel';
import { QueryState } from '@/components/ui/QueryState';

/**
 * CP-022 — the ONE canonical order-detail loader. Every entry point (Orders,
 * Analysis, and Shipments drawers) renders order detail through this: it fetches
 * the canonical GET /orders/:id DTO and renders it. The launching page's list
 * row only drives the table — it can never change the visible detail truth,
 * because the modal always re-reads the single backend-owned order DTO.
 */
export function OrderDetailLoader({ id }: { id: number }) {
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
    return (
      <QueryState isLoading={false} isError onRetry={() => q.refetch()}>
        <></>
      </QueryState>
    );
  }
  return <OrderDetailPanel o={q.data.data} />;
}
