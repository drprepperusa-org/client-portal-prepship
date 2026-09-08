import type { RequestAuth } from '../transport';
import type {
  IntegrationValidationResult,
  NewIntegrationInput,
  PortalIntegration,
  SyncStatus,
} from '@client-portal-contracts/connections';
import { apiDelete, apiGet, apiPatch, apiPost } from '../transport';

export const connectionsApi = {
  syncStatus: (token: RequestAuth) =>
    apiGet<SyncStatus>(token, '/api/client-portal/sync-status'),
  integrations: (token: RequestAuth) =>
    apiGet<{ data: PortalIntegration[] }>(token, '/api/client-portal/integrations'),
  createIntegration: (token: RequestAuth, body: NewIntegrationInput) =>
    apiPost<{ data: PortalIntegration }>(token, '/api/client-portal/integrations', body),
  validateIntegration: (
    token: RequestAuth,
    body: { provider: string; credentials: Record<string, string> },
  ) =>
    apiPost<{ data: IntegrationValidationResult }>(
      token,
      '/api/client-portal/integrations/validate',
      body,
    ),
  reconnectIntegration: (token: RequestAuth, id: number, credentials: Record<string, string>) =>
    apiPatch<{ data: { ok: boolean } }>(
      token,
      `/api/client-portal/integrations/${id}/credentials`,
      { credentials },
    ),
  renameIntegration: (token: RequestAuth, id: number, label: string) =>
    apiPatch<{ data: PortalIntegration }>(
      token,
      `/api/client-portal/integrations/${id}/label`,
      { label },
    ),
  approveIntegration: (token: RequestAuth, id: number) =>
    apiPost<{ data: PortalIntegration }>(
      token,
      `/api/client-portal/integrations/${id}/approve`,
    ),
  disconnectIntegration: (token: RequestAuth, id: number) =>
    apiDelete<{ data: { id: number; deleted: boolean; cascadedClientId: number | null } }>(
      token,
      `/api/client-portal/integrations/${id}`,
    ),
};
