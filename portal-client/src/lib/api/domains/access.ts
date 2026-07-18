import type {
  AccessUserInviteInput,
  AccessUserInviteResult,
  AccessUserPatch,
  PortalAccessUser,
  PortalAuditClickInput,
  PortalAuditLogResponse,
  PortalClientRow,
  PortalMe,
} from '@client-portal-contracts/access';
import { apiDelete, apiGet, apiPatch, apiPost } from '../transport';

export const accessApi = {
  me: (token: string) => apiGet<PortalMe>(token, '/api/client-portal/me'),
  auditLog: (token: string, opts: { search?: string; limit?: number; storeId?: number | null } = {}) =>
    apiGet<PortalAuditLogResponse>(token, '/api/client-portal/audit-log', {
      search: opts.search,
      limit: opts.limit ?? 100,
      storeId: opts.storeId,
    }),
  auditClick: (token: string, body: PortalAuditClickInput) =>
    apiPost<{ ok: true }>(token, '/api/client-portal/audit-log/click', body),
  clients: (token: string) =>
    apiGet<{ data: PortalClientRow[] }>(token, '/api/client-portal/clients'),
  accessList: (token: string) =>
    apiGet<{ data: PortalAccessUser[] }>(token, '/api/client-portal/access-list'),
  inviteAccessUser: (token: string, invite: AccessUserInviteInput) =>
    apiPost<AccessUserInviteResult>(token, '/api/client-portal/access-list/invite', invite),
  completeAccessActivation: (token: string) =>
    apiPost<{ ok: true }>(token, '/api/client-portal/access-list/activate'),
  updateAccessUser: (token: string, id: string, patch: AccessUserPatch) =>
    apiPatch<{ ok: true }>(token, `/api/client-portal/access-list/${id}`, patch),
  deleteAccessUser: (token: string, id: string) =>
    apiDelete<{ ok: true }>(token, `/api/client-portal/access-list/${id}`),
};
