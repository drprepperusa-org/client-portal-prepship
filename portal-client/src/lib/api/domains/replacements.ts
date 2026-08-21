import type {
  PortalReplacementDetail,
  PortalReplacementRow,
} from '@client-portal-contracts/replacements';
import { apiGet, apiPost } from '../transport';

// CP-061 — Replace surface. Reads are scoped server-side; create FORWARDS to
// the canonical PrepShip command (the portal owns no replacement decisions).
export const replacementsApi = {
  replacements: (token: string, clientId?: number) =>
    apiGet<{ data: PortalReplacementRow[] }>(token, '/api/client-portal/replacements', { clientId }),
  replacement: (token: string, id: number) =>
    apiGet<{ data: PortalReplacementDetail }>(token, `/api/client-portal/replacements/${id}`),
  createReplacement: (token: string, body: { orderId: number; reason: string; items: Array<{ sku: string; quantity: number }> }) =>
    apiPost<Record<string, unknown>>(token, '/api/client-portal/replacements', body),
};
