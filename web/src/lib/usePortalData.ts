import { useCallback, useEffect, useState } from 'react';
import { portalApi } from './api';
import {
  DEMO_TOKEN,
  demoBilling,
  demoDailyCounts,
  demoDashboard,
  demoInventory,
  demoOrders,
  demoShipments,
} from './demo-data';

type LoadState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

export function usePortalData<T>(
  token: string | null,
  loader: (token: string) => Promise<T>,
): LoadState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const reload = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    loader(token)
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loader, token, version]);

  return { data, loading, error, reload };
}

export function portalLoaders() {
  return {
    dashboard: (token: string) =>
      token === DEMO_TOKEN ? Promise.resolve(demoDashboard) : portalApi.dashboard(token),
    dailyCounts: (token: string) =>
      token === DEMO_TOKEN ? Promise.resolve(demoDailyCounts) : portalApi.dailyCounts(token),
    orders: (token: string) =>
      token === DEMO_TOKEN ? Promise.resolve(demoOrders) : portalApi.orders(token),
    shipments: (token: string) =>
      token === DEMO_TOKEN ? Promise.resolve(demoShipments) : portalApi.shipments(token),
    inventory: (token: string) =>
      token === DEMO_TOKEN ? Promise.resolve(demoInventory) : portalApi.inventory(token),
    billing: (token: string) =>
      token === DEMO_TOKEN ? Promise.resolve(demoBilling) : portalApi.billingSummary(token),
    clients: (token: string) =>
      token === DEMO_TOKEN ? Promise.resolve({ data: [{ id: 1, name: 'DrPrepperUSA', active: true }] }) : portalApi.clients(token),
    settings: (token: string) =>
      token === DEMO_TOKEN
        ? Promise.resolve({ data: [{ key: 'defaultView', value: 'dashboard' }, { key: 'pageSize', value: '25' }] })
        : portalApi.settings(token),
    products: (token: string) =>
      token === DEMO_TOKEN ? Promise.resolve({ data: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 } }) : portalApi.products(token),
    analysisOverview: (token: string) =>
      token === DEMO_TOKEN ? Promise.resolve({ ordersToday: 2, ordersWeek: 18, shippedToday: 3, shippedWeek: 25 }) : portalApi.analysisOverview(token),
    dailyShipments: (token: string) =>
      token === DEMO_TOKEN ? Promise.resolve({ data: [{ day: '2026-05-25', shipments: 3 }, { day: '2026-05-24', shipments: 5 }] }) : portalApi.dailyShipments(token),
    carrierAccounts: (token: string) =>
      token === DEMO_TOKEN
        ? Promise.resolve({ data: [{ id: 1, provider: 'walmart', label: 'Walmart Marketplace', accountIdentifier: 'Walmart Seller (b05d64...)', active: true, createdAt: '2026-05-06T00:00:00.000Z' }] })
        : portalApi.carrierAccounts(token),
  };
}
