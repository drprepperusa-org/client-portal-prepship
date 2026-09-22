export interface PortalMe {
  id: string | null;
  email: string | null;
  role: string | null;
  isAdmin: boolean;
  isGlobal?: boolean;
  isRestricted?: boolean;
  clientIds?: number[];
  storeIds?: number[];
  permissions?: string[];
  canViewFinancials?: boolean;
  canViewCredentials?: boolean;
  canManageUsers: boolean;
  canManageAdmins: boolean;
  canViewAudit: boolean;
  canReceiveInventory: boolean;
  canInspectReturns: boolean;
  canRequestReplacements: boolean;
}

export interface PortalAuditActivity {
  category: 'Navigation' | 'Data request' | 'Background check' | 'Action';
  outcome: 'Recorded' | 'Reported' | 'Requested' | 'Completed' | 'Failed' | 'Denied';
  label: string;
  summary: string;
  note: string;
  details: Array<{ label: string; value: string }>;
}

export interface PortalAuditInvestigationFilters {
  /** ISO instants: inclusive start, exclusive end, over recorded created_at. */
  dateFrom?: string;
  dateTo?: string;
  activity?: 'all' | 'views' | 'actions' | 'navigation' | 'failed' | 'denied';
  hideBackground?: boolean;
}

export interface PortalAuditLogFilters extends PortalAuditInvestigationFilters {
  search?: string;
  storeId?: number | null;
  clientId?: number | null;
  actorEmail?: string;
}

export interface PortalAuditLogRow {
  id: number;
  event: string;
  actorUserId: string | null;
  actorEmail: string | null;
  clientIds: number[];
  storeIds: number[];
  clientNames: string[];
  storeNames: string[];
  scopeLabel: string;
  metadata: Record<string, unknown>;
  activity?: PortalAuditActivity;
  createdAt: string;
}

export interface PortalAuditLogStoreFilter {
  id: number;
  name: string;
}

export interface PortalAuditLogResponse {
  data: PortalAuditLogRow[];
  filters: {
    stores: PortalAuditLogStoreFilter[];
    users?: string[];
    clients?: PortalAuditLogStoreFilter[];
  };
  pagination?: { page: number; pageSize: number; hasMore: boolean };
}

export interface PortalAuditClickInput {
  target: string;
  to?: string;
  from?: string;
}

export interface PortalClientRow {
  id: number;
  name: string | null;
  email: string | null;
  active: boolean | null;
  storeIds?: number[] | null;
}

export interface PortalAccessUser {
  id: string;
  email: string;
  name: string | null;
  role: string | null;
  permissions: string[];
  isAdmin: boolean;
  isGlobal: boolean;
  isProtected: boolean;
  active: boolean;
  clientIds: number[];
  storeIds: number[];
  clients: PortalClientRow[];
  createdAt: string | null;
  lastSignInAt: string | null;
}

export interface AccessUserPatch {
  role?: 'admin' | 'client_user';
  clientIds?: number[];
  displayName?: string;
  active?: boolean;
}

export interface AccessUserInviteInput {
  email: string;
  displayName?: string;
  role: 'admin' | 'client_user';
  clientIds?: number[];
}

export interface AccessUserInviteResult {
  ok: true;
  emailSent?: boolean;
  activationLink?: string | null;
  user: {
    id: string;
    email: string;
    role: 'admin' | 'client_user';
    clientIds: number[];
  };
}

/** Backend-owned audit overview. Recorded events are not proof of online presence. */
export interface PortalClientActivityEvent {
  id: number;
  actorEmail: string | null;
  actorUserId: string | null;
  createdAt: string;
  activity: PortalAuditActivity;
}
export interface PortalClientActivityResponse {
  data: Array<{
    clientId: number;
    clientName: string;
    active: boolean;
    latestEvent: PortalClientActivityEvent | null;
    recentActions: PortalClientActivityEvent[];
    failedCount: number;
    deniedCount: number;
  }>;
  window: { dateFrom: string; dateTo: string; days: number };
  pagination: { page: number; pageSize: number; hasMore: boolean };
}
