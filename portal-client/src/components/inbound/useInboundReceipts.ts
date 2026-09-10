import { useTokenQuery } from '@/lib/hooks';
import { portalApi } from '@/lib/api';
import { usePortalFilters } from '@/lib/portalContext';

export function useInboundReceipts(clientId?: number, page = 1, pageSize = 50, sortBy?: string, sortDir?: 'asc' | 'desc') {
  const { clientId: globalClientId } = usePortalFilters();
  const effectiveClientId = clientId ?? globalClientId;
  return useTokenQuery(
    ['inbound-receipts', effectiveClientId ?? 'scope', page, pageSize, sortBy, sortDir],
    (token) => portalApi.inboundReceipts(token, { clientId: effectiveClientId, page, pageSize, sortBy, sortDir }),
    true, { retainDataScope: ['inbound-receipts', effectiveClientId ?? 'scope'] },
  );
}
