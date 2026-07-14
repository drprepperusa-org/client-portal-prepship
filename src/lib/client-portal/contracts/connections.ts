export const PORTAL_CONNECTION_STATUSES = [
  'pending',
  'active',
  'reconnect',
  'degraded',
  'inactive',
] as const;

export type PortalConnectionStatus = (typeof PORTAL_CONNECTION_STATUSES)[number];

export const PORTAL_RECONNECT_REASON_CODES = [
  'authentication_required',
  'permissions_required',
  'configuration_required',
] as const;

export type PortalReconnectReasonCode = (typeof PORTAL_RECONNECT_REASON_CODES)[number];

export interface PortalIntegration {
  id?: number;
  clientId: number | null;
  provider: string | null;
  label: string | null;
  displayAccountIdentifier: string | null;
  connectionStatus: PortalConnectionStatus;
  reconnectReasonCode: PortalReconnectReasonCode | null;
  createdAt: string | null;
  updatedAt: string | null;
  type: string;
  assignedClientIds: number[];
  clientName: string | null;
  storeName: string | null;
  storeIds: number[];
  lastSyncedAt: string | null;
}

export interface NewIntegrationInput {
  provider: string;
  label: string;
  clientId?: number;
  credentials: Record<string, string>;
}

export interface IntegrationValidationResult {
  ok: boolean;
  displayAccountIdentifier?: string;
}

export interface SyncStatus {
  connectionStatus: 'attention' | 'active' | 'pending' | 'inactive' | 'not_connected';
  lastSyncAt: string | null;
  connections: Array<{
    id?: number;
    connectionStatus: PortalConnectionStatus;
    lastSyncedAt: string | null;
  }>;
}
