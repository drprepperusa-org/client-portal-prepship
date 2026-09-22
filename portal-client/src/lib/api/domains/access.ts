import type { RequestAuth } from '../transport';
import type {
  AccessUserInviteInput,
  AccessUserInviteResult,
  AccessUserPatch,
  PortalAccessUser,
  PortalAuditClickInput,
  PortalClientActivityResponse,
  PortalAuditLogResponse,
  PortalAuditLogFilters,
  PortalClientRow,
  PortalMe,
} from '@client-portal-contracts/access';
import { apiBlob, apiDelete, apiGet, apiPatch, apiPost } from '../transport';

const auditFilters = (opts: PortalAuditLogFilters) => ({
  search: opts.search, storeId: opts.storeId, clientId: opts.clientId, actorEmail: opts.actorEmail,
  dateFrom: opts.dateFrom, dateTo: opts.dateTo, activity: opts.activity, hideBackground: opts.hideBackground,
});

export const accessApi = {
  clientActivity: (token: RequestAuth, opts: { search: string; page: number; days: number }) =>
    apiGet<PortalClientActivityResponse>(token, '/api/client-portal/audit-log/client-activity', opts),
  me: (token: RequestAuth) => apiGet<PortalMe>(token, '/api/client-portal/me'),
  auditLog: (token: RequestAuth, opts: PortalAuditLogFilters & { limit?: number; page?: number } = {}) =>
    apiGet<PortalAuditLogResponse>(token, '/api/client-portal/audit-log', {
      ...auditFilters(opts),
      limit: opts.limit ?? 100,
      page: opts.page,
    }),
  auditCsv: (token: RequestAuth, opts: PortalAuditLogFilters = {}) =>
    apiBlob(token, '/api/client-portal/audit-log', { ...auditFilters(opts), format: 'csv' }, 'text/csv'),
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
