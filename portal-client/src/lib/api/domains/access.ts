import type { RequestAuth } from '../transport';
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
  me: (token: RequestAuth) => apiGet<PortalMe>(token, '/api/client-portal/me'),
  auditLog: (token: RequestAuth, opts: { search?: string; limit?: number; storeId?: number | null } = {}) =>
    apiGet<PortalAuditLogResponse>(token, '/api/client-portal/audit-log', {
      search: opts.search,
      limit: opts.limit ?? 100,
      storeId: opts.storeId,
    }),
  auditClick: (token: RequestAuth, body: PortalAuditClickInput) =>
    apiPost<{ ok: true }>(token, '/api/client-portal/audit-log/click', body),
  clients: (token: RequestAuth) =>
    apiGet<{ data: PortalClientRow[] }>(token, '/api/client-portal/clients'),
  accessList: (token: RequestAuth) =>
    apiGet<{ data: PortalAccessUser[] }>(token, '/api/client-portal/access-list'),
  inviteAccessUser: (token: RequestAuth, invite: AccessUserInviteInput) =>
    apiPost<AccessUserInviteResult>(token, '/api/client-portal/access-list/invite', invite),
  completeAccessActivation: (token: RequestAuth) =>
    apiPost<{ ok: true }>(token, '/api/client-portal/access-list/activate'),
  updateAccessUser: (token: RequestAuth, id: string, patch: AccessUserPatch) =>
    apiPatch<{ ok: true }>(token, `/api/client-portal/access-list/${id}`, patch),
  deleteAccessUser: (token: RequestAuth, id: string) =>
    apiDelete<{ ok: true }>(token, `/api/client-portal/access-list/${id}`),
};
