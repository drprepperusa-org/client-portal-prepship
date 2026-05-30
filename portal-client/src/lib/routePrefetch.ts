/**
 * Warms a route's lazy chunk on sidebar hover so the click feels instant.
 * Keys match the paths in nav.ts; each value triggers the same dynamic import
 * App.tsx uses, so the chunk is already in the browser cache by click time.
 */
const IMPORTERS: Record<string, () => Promise<unknown>> = {
  '/': () => import('@/pages/Dashboard'),
  '/orders': () => import('@/pages/Orders'),
  '/inbound': () => import('@/pages/Inbound'),
  '/shipments': () => import('@/pages/Shipments'),
  '/inventory': () => import('@/pages/Inventory'),
  '/analysis': () => import('@/pages/Analysis'),
  '/finance': () => import('@/pages/Finance'),
  '/billing': () => import('@/pages/Billing'),
  '/rates': () => import('@/pages/Rates'),
  '/connections': () => import('@/pages/Connections'),
  '/settings': () => import('@/pages/Settings'),
  '/components': () => import('@/pages/Components'),
};

const warmed = new Set<string>();

export function prefetchRoute(path: string) {
  if (warmed.has(path)) return;
  const importer = IMPORTERS[path];
  if (!importer) return;
  warmed.add(path);
  void importer().catch(() => warmed.delete(path));
}
