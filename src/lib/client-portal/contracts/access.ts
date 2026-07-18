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
  };
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
