import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/auth';
import type { PortalDateRange } from '@/lib/api';

interface PortalFilters {
  /** Active client filter (undefined = all clients in scope). */
  clientId?: number;
  setClientId: (id?: number) => void;
  /** Explicit dashboard/reporting window as local YYYY-MM-DD days. */
  dateRange: PortalDateRange;
  setDateRange: (range: PortalDateRange) => void;
  /** Inclusive day count for labels and legacy date-ranged surfaces. */
  days: number;
  setDays: (d: number) => void;
}

const Ctx = createContext<PortalFilters | null>(null);

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseYmdLocal(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function lastDaysRange(days: number): PortalDateRange {
  const safeDays = Math.max(1, Math.floor(days));
  const dateTo = new Date();
  dateTo.setHours(0, 0, 0, 0);
  const dateFrom = new Date(dateTo);
  dateFrom.setDate(dateTo.getDate() - (safeDays - 1));
  return { dateFrom: toYmd(dateFrom), dateTo: toYmd(dateTo), preset: safeDays === 30 ? 'last_30' : `last_${safeDays}` };
}

export function daysBetweenInclusive(dateFrom: string, dateTo: string): number {
  const from = parseYmdLocal(dateFrom);
  const to = parseYmdLocal(dateTo);
  const ms = to.getTime() - from.getTime();
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

export function PortalFiltersProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth();
  const [clientId, setClientId] = useState<number | undefined>(undefined);
  const [dateRange, setDateRange] = useState<PortalDateRange>(() => lastDaysRange(30));
  const setDays = useCallback((days: number) => setDateRange(lastDaysRange(days)), []);

  // Reset filters when the signed-in user changes so one account's selected
  // client/date window never carries into another account's session.
  const prevUserId = useRef<string | null>(userId);
  useEffect(() => {
    if (prevUserId.current !== userId) {
      prevUserId.current = userId;
      setClientId(undefined);
      setDateRange(lastDaysRange(30));
    }
  }, [userId]);

  const days = daysBetweenInclusive(dateRange.dateFrom, dateRange.dateTo);

  const value = useMemo<PortalFilters>(
    () => ({
      clientId,
      setClientId,
      dateRange,
      setDateRange,
      days,
      setDays,
    }),
    [clientId, dateRange, days, setDays],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePortalFilters(): PortalFilters {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('usePortalFilters must be used within PortalFiltersProvider');
  return ctx;
}
