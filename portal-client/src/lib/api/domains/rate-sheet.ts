import type { PortalRateSheet } from '@client-portal-contracts/rate-sheet';
import type { RequestAuth } from '../transport';
import { apiGet } from '../transport';

export const rateSheetApi = {
  rateSheet: (token: RequestAuth, clientId?: number) =>
    apiGet<{ data: PortalRateSheet[] }>(token, '/api/client-portal/rate-sheet', { clientId }),
};
