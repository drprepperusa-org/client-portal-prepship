import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';

/**
 * Global "reconnecting" banner. React Query retries transient failures — a
 * network drop, a timeout, or a 5xx — e.g. while the Render API is waking from
 * idle (see the 30s timeout in lib/api.ts + the retry policy in main.tsx). This
 * surfaces that retrying state so a slow load reads as "the server is waking up"
 * rather than a frozen page of skeletons.
 *
 * It appears ONLY while a query is actively retrying after such a failure
 * (fetchStatus 'fetching' with at least one recorded fetch failure). Expected
 * client errors (401/403/404) don't retry — main.tsx short-circuits them — so
 * they never trip this. It clears the instant a request succeeds.
 */
export function ConnectionStatus() {
  const queryClient = useQueryClient();
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    const cache = queryClient.getQueryCache();
    const recompute = () =>
      setReconnecting(
        cache
          .getAll()
          .some((q) => q.state.fetchStatus === 'fetching' && q.state.fetchFailureCount > 0),
      );
    recompute();
    return cache.subscribe(recompute);
  }, [queryClient]);

  return (
    <AnimatePresence>
      {reconnecting && (
        <motion.div
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.2 }}
          className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex justify-center px-3"
        >
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50/90 px-4 py-1.5 text-sm font-medium text-amber-800 shadow-lg backdrop-blur">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-300 border-t-amber-700" />
            Reconnecting to the server…
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
