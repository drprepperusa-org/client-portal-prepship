import { motion } from 'framer-motion';

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <motion.div
      className={`bg-surface-3 rounded-md ${className}`}
      animate={{ opacity: [0.4, 1, 0.4] }}
      transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
    />
  );
}

export function KpiSkeleton() {
  return (
    <div className="portal-kpi flex flex-col gap-3">
      <Skeleton className="h-14 w-14 rounded-full" />
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-3 w-40" />
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="portal-panel flex h-[360px] flex-col p-5 gap-4">
      <div className="flex justify-between items-center">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-5 w-24" />
      </div>
      <Skeleton className="flex-1 w-full rounded-lg" />
    </div>
  );
}

export function TableRowSkeleton() {
  return (
    <div className="flex items-center justify-between py-4 border-b border-line">
      <Skeleton className="h-4 w-8" />
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-4 w-16" />
    </div>
  );
}
