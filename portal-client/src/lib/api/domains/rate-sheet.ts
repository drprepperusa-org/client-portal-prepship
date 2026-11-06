import type { PortalRateSheet } from '@client-portal-contracts/rate-sheet';
import type { RequestAuth } from '../transport';
import { apiGet, apiPost } from '../transport';

export const rateSheetApi = {
  rateSheetAccess: (token: RequestAuth) => apiGet<{ canEditRateSheet: boolean }>(token, '/api/client-portal/rate-sheet/access'),
  saveRateSheet: (token: RequestAuth, operation: 'services' | 'package' | 'add-box', body: unknown) =>
    apiPost<{ ok: true }>(token, `/api/client-portal/rate-sheet/${operation}`, body),
  rateSheet: (token: RequestAuth, clientId?: number) =>
    apiGet<{ data: PortalRateSheet[] }>(token, '/api/client-portal/rate-sheet', { clientId }),
};
