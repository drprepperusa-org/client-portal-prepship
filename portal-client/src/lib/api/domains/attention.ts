import type { PortalAttention } from '@client-portal-contracts/attention';
import { apiGet, type RequestAuth } from '../transport';

export const attentionApi = {
  attention: (token: RequestAuth, clientId?: number) =>
    apiGet<PortalAttention>(token, '/api/client-portal/attention', { clientId }),
};
