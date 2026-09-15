import type { PortalAuditActivity } from '../contracts/access';

// Audit facts come from the persisted event and its metadata at created_at.
// Do not join today's mutable records to invent historical values or outcomes.
const FIELDS: Record<string, string> = {
  orderNumber: 'Order number', orderId: 'Order ID', shipmentId: 'Shipment ID',
  returnId: 'Return ID', replacementId: 'Replacement ID', inventoryId: 'Inventory ID',
  inventoryIds: 'Inventory IDs', ledgerIds: 'Ledger IDs', id: 'Record ID',
  targetId: 'Affected user ID', sku: 'SKU', clientId: 'Activity client ID',
  clientIds: 'Assigned client IDs', storeId: 'Activity store ID', storeIds: 'Activity store IDs',
  status: 'Status filter', page: 'Page', pageSize: 'Per page', search: 'Search',
  query: 'Search', q: 'Search', from: 'From', to: 'To', dateFrom: 'Date from', dateTo: 'Date to',
  lowStock: 'Low-stock filter', sortBy: 'Requested sort', sortDir: 'Sort direction',
  rows: 'Returned rows', total: 'Matching rows', count: 'Count', orders: 'Orders',
  checked: 'Checked', updated: 'Updated', requested: 'Requested',
  itemCount: 'Item count', items: 'Items', totalUnits: 'Total units', qty: 'Quantity',
  reference: 'Reference', receivedAt: 'Received at', format: 'File format',
  reason: 'Reason', code: 'Result code', jobId: 'Job ID',
  role: 'Submitted role', active: 'Submitted active status', renamed: 'Name edit submitted',
  target: 'Clicked', type: 'Type', value: 'Submitted value',
  groupBy: 'Group by', granularity: 'Period grouping',
};

const SUBJECTS: Record<string, string> = {
  orders: 'orders', 'orders.detail': 'order details', inventory: 'inventory',
  'inventory.history': 'inventory history', 'inventory.receive': 'inventory receipt',
  shipments: 'shipments', 'shipments.refresh_tracking': 'shipment tracking',
  invoice_summary: 'billing summary', invoice_details: 'invoice details', invoice_export: 'invoice export',
  'billing.order_shipments': 'order shipments', access_list: 'user access',
  'access_list.update': 'user access update', dashboard: 'dashboard', analysis: 'analysis',
  replacements: 'replacements', 'replacements.create': 'replacement request',
};

const ACTIONS: Record<string, string> = {
  create: 'Created', update: 'Updated', set: 'Updated', delete: 'Deleted',
  receive: 'Received', import: 'Imported', approve: 'Approved', reconnect: 'Reconnected',
  rename: 'Renamed', disconnect: 'Disconnected', validate: 'Validated', invite: 'Invited', activate: 'Activated',
};

function words(value: string): string {
  return value.replace(/[._-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
}

function route(value: string): string {
  const path = value.split(/[?#]/)[0] ?? '';
  return path === '/' ? 'Dashboard' : words(path.replace(/^\//, ''));
}

function printable(value: unknown, key: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (value === '[redacted]') return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'string') {
    if (key === 'from' || key === 'to') return value.startsWith('/') ? route(value) : value.slice(0, 500);
    return ['status', 'role', 'sortDir'].includes(key) ? words(value) : value.slice(0, 500);
  }
  if (Array.isArray(value)) {
    // Show actual recorded IDs/values, not just "3 items". No raw object payloads.
    return value.slice(0, 20).map(item => printable(item, key)).filter(Boolean).join(', ') || 'None';
  }
  return null;
}

export function buildPortalAuditActivity(event: string, metadata: Record<string, unknown>): PortalAuditActivity {
  const details = Object.entries(FIELDS).flatMap(([key, label]) => {
    const value = printable(metadata[key], key);
    return value === null ? [] : [{ label, value }];
  });
  const parts = event.replace(/^portal\./, '').split('.');
  const action = parts.pop() ?? '';
  const name = parts.join('.');
  const subject = SUBJECTS[name] ?? words(name || event);
  let category: PortalAuditActivity['category'] = 'Action';
  let outcome: PortalAuditActivity['outcome'] = 'Recorded';
  let label = ACTIONS[action] ? `${ACTIONS[action]} ${subject}` : `Recorded ${words(action)}: ${subject}`;
  let note = 'Only recorded fields are shown. Before/after values and unrecorded clicks cannot be reconstructed.';

  if (['denied', 'failed', 'requested', 'completed'].includes(action)) {
    outcome = ({ denied: 'Denied', failed: 'Failed', requested: 'Requested', completed: 'Completed' } as const)[action as 'denied' | 'failed' | 'requested' | 'completed'];
    label = `${subject}: ${outcome.toLowerCase()}`;
    if (action === 'requested') note = 'This records a request, not proof that the action completed. Look for its completion event.';
  } else if (event === 'portal.ui.click') {
    category = 'Navigation'; outcome = 'Reported'; label = 'Navigation click';
    note = 'Navigation reported by the browser. It does not establish that a subsequent operation succeeded.';
  } else if (event === 'portal.orders.awaiting_active_count' || event === 'portal.me.view') {
    category = 'Background check';
    label = event === 'portal.me.view' ? 'Portal session checked' : 'Awaiting shipment count checked';
    note = 'The portal can request this automatically. This is not evidence of a deliberate click or a new sign-in.';
  } else if (['view', 'list', 'detail', 'history', 'daily_counts', 'sku_orders', 'daily_shipments', 'reason_contract'].includes(action)) {
    category = 'Data request';
    label = `Loaded ${SUBJECTS[`${name}.${action}`] ?? subject}`;
    note = 'A server data request was recorded. Opening a page, preloading or refreshing it can cause this event.';
  }
  label = label.charAt(0).toUpperCase() + label.slice(1);
  const context = details.slice(0, 4).map(detail => `${detail.label}: ${detail.value}`).join(' · ');
  let summary = context ? `${label} — ${context}` : `${label}. Additional context was not recorded.`;
  if (category === 'Navigation') {
    const target = printable(metadata.target, 'target');
    const from = printable(metadata.from, 'from');
    const to = printable(metadata.to, 'to');
    summary = `Clicked ${target ?? 'an unrecorded target'}${from ? ` from ${from}` : ''}${to ? ` to ${to}` : ''}.`;
  }
  return { category, outcome, label, summary, note, details };
}
