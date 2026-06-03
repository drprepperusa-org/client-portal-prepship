/**
 * Per-user dashboard customization: the order of the dashboard widgets and
 * which ones are hidden. Persisted to localStorage so each operator's layout
 * survives reloads without a backend round-trip.
 */
export type WidgetId = 'kpis' | 'ordersChart' | 'volumeChart' | 'topSkus';

export const ALL_WIDGETS: WidgetId[] = ['kpis', 'ordersChart', 'volumeChart', 'topSkus'];

export const WIDGET_LABELS: Record<WidgetId, string> = {
  kpis: 'Key metrics',
  ordersChart: 'Orders over time',
  volumeChart: 'Shipment volume',
  topSkus: 'Top SKUs',
};

export interface DashLayout {
  order: WidgetId[];
  hidden: WidgetId[];
}

export const DEFAULT_LAYOUT: DashLayout = { order: [...ALL_WIDGETS], hidden: [] };

const keyFor = (userId: string | null | undefined) => `prepship.dashLayout.${userId ?? 'anon'}`;

/** Coerce a stored layout into a valid one: keep known widgets in their saved
 *  order, append any new widgets that didn't exist when the layout was saved,
 *  and drop unknown ids. This keeps old saved layouts working as we add widgets. */
function normalize(raw: Partial<DashLayout> | null): DashLayout {
  const savedOrder = Array.isArray(raw?.order) ? raw!.order.filter((id): id is WidgetId => ALL_WIDGETS.includes(id as WidgetId)) : [];
  const order = [...savedOrder, ...ALL_WIDGETS.filter((id) => !savedOrder.includes(id))];
  const hidden = Array.isArray(raw?.hidden) ? raw!.hidden.filter((id): id is WidgetId => ALL_WIDGETS.includes(id as WidgetId)) : [];
  return { order, hidden };
}

export function loadLayout(userId: string | null | undefined): DashLayout {
  try {
    const raw = window.localStorage.getItem(keyFor(userId));
    return raw ? normalize(JSON.parse(raw) as Partial<DashLayout>) : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function saveLayout(userId: string | null | undefined, layout: DashLayout): void {
  try {
    window.localStorage.setItem(keyFor(userId), JSON.stringify(layout));
  } catch {
    /* storage unavailable (private mode / quota) — layout just won't persist */
  }
}
