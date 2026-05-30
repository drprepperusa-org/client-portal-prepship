import type { ReactNode } from 'react';
import { AlertTriangle, Inbox } from 'lucide-react';
import { SkeletonRows, EmptyState } from './Display';
import { Button } from './Button';

interface QueryStateProps {
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  isEmpty?: boolean;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyMessage?: string;
  skeletonRows?: number;
  children: ReactNode;
}

/** Consistent loading / error / empty wrapper for live-data panels. */
export function QueryState({
  isLoading,
  isError,
  error,
  isEmpty,
  onRetry,
  emptyTitle = 'Nothing here yet',
  emptyMessage = 'There is no data to show for this view.',
  skeletonRows = 8,
  children,
}: QueryStateProps) {
  if (isLoading) return <div className="p-4"><SkeletonRows rows={skeletonRows} /></div>;
  if (isError) {
    return (
      <EmptyState
        icon={<AlertTriangle size={26} />}
        title="Couldn't load data"
        message={error instanceof Error ? error.message : 'The request failed. Please try again.'}
        action={onRetry ? <Button size="sm" onClick={onRetry}>Retry</Button> : undefined}
      />
    );
  }
  if (isEmpty) return <EmptyState icon={<Inbox size={26} />} title={emptyTitle} message={emptyMessage} />;
  return <>{children}</>;
}
