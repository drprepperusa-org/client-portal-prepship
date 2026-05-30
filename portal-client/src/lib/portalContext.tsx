import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth';

interface PortalFilters {
  /** Active client filter (undefined = all clients in scope). */
  clientId?: number;
  setClientId: (id?: number) => void;
  /** Lookback window in days for date-ranged endpoints. */
  days: number;
  setDays: (d: number) => void;
  /** Force a refetch of all portal data. */
  refreshAll: () => void;
}

const Ctx = createContext<PortalFilters | null>(null);

export function PortalFiltersProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { userId } = useAuth();
  const [clientId, setClientId] = useState<number | undefined>(undefined);
  const [days, setDays] = useState(30);

  // Reset filters when the signed-in user changes so one account's selected
  // client/date window never carries into another account's session.
  const prevUserId = useRef<string | null>(userId);
  useEffect(() => {
    if (prevUserId.current !== userId) {
      prevUserId.current = userId;
      setClientId(undefined);
      setDays(30);
    }
  }, [userId]);

  const value = useMemo<PortalFilters>(
    () => ({
      clientId,
      setClientId,
      days,
      setDays,
      refreshAll: () => qc.invalidateQueries(),
    }),
    [clientId, days, qc],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePortalFilters(): PortalFilters {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePortalFilters must be used within PortalFiltersProvider');
  return ctx;
}
