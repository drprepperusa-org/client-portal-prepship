import type {
  PortalConnectionStatus,
  PortalReconnectReasonCode,
} from './api';

export const CONNECTION_STATUS_META: Record<
  PortalConnectionStatus,
  { label: string; className: string }
> = {
  pending: { label: 'Pending approval', className: 'bg-amber-50 text-amber-600' },
  active: { label: 'Active — syncing', className: 'bg-emerald-50 text-emerald-600' },
  reconnect: { label: 'Reconnect needed', className: 'bg-rose-50 text-rose-600' },
  degraded: { label: 'Sync delayed', className: 'bg-amber-50 text-amber-600' },
  inactive: { label: 'Inactive', className: 'bg-slate-100 text-ink-3' },
};

const RECONNECT_REASON_COPY: Record<PortalReconnectReasonCode, string> = {
  authentication_required: 'Your store credentials need to be updated.',
  permissions_required: 'Your store connection needs updated permissions.',
  configuration_required: 'Your store connection needs configuration help.',
};

const UNAVAILABLE = { label: 'Unavailable', className: 'bg-slate-100 text-ink-3' };

/** Presentation-only exhaustive mapping of the backend-owned status enum. */
export function connectionStatusMeta(status: unknown) {
  return typeof status === 'string' && status in CONNECTION_STATUS_META
    ? CONNECTION_STATUS_META[status as PortalConnectionStatus]
    : UNAVAILABLE;
}

export function reconnectReasonCopy(code: PortalReconnectReasonCode | null): string | null {
  return code ? RECONNECT_REASON_COPY[code] : null;
}

export const CONNECTION_FRESHNESS_META = {
  attention: { label: 'A store connection needs attention.', dotClassName: 'bg-rose-500' },
  active: { label: 'Store connections are active.', dotClassName: 'bg-emerald-500' },
  pending: { label: 'A store connection is pending approval.', dotClassName: 'bg-amber-400' },
  inactive: { label: 'Store connections are inactive.', dotClassName: 'bg-slate-400' },
  not_connected: { label: 'No store connection is configured.', dotClassName: 'bg-slate-400' },
} as const;

export function connectionFreshnessMeta(status: unknown) {
  return typeof status === 'string' && status in CONNECTION_FRESHNESS_META
    ? CONNECTION_FRESHNESS_META[status as keyof typeof CONNECTION_FRESHNESS_META]
    : { label: 'Connection status is unavailable.', dotClassName: 'bg-slate-400' };
}
