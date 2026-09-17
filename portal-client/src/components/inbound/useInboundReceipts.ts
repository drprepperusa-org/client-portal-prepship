import { useTokenQuery } from '@/lib/hooks';
import { portalApi, type ListOpts } from '@/lib/api';
import { usePortalFilters } from '@/lib/portalContext';

export function useInboundReceipts(clientId?: number, page = 1, pageSize = 50, sortBy?: string, sortDir?: 'asc' | 'desc',
  dates: Pick<ListOpts, 'dateFrom' | 'dateTo'> = {}, enabled = true) {
  const { clientId: globalClientId } = usePortalFilters();
  const effectiveClientId = clientId ?? globalClientId;
  return useTokenQuery(
    ['inbound-receipts', effectiveClientId ?? 'scope', page, pageSize, sortBy, sortDir, dates.dateFrom, dates.dateTo],
    (token) => portalApi.inboundReceipts(token, { clientId: effectiveClientId, page, pageSize, sortBy, sortDir, ...dates }),
    enabled, { retainDataScope: ['inbound-receipts', effectiveClientId ?? 'scope'] },
  );
}
