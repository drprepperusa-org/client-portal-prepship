import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/auth';
import { portalApi } from '@/lib/api';
import { usePortalFilters } from '@/lib/portalContext';

export function useInboundReceipts(clientId?: number, page = 1, pageSize = 50) {
  const { accessToken } = useAuth();
  const { clientId: globalClientId, dateRange } = usePortalFilters();
  const effectiveClientId = clientId ?? globalClientId;
  return useQuery({
    queryKey: ['inbound-receipts', effectiveClientId ?? 'scope', page, pageSize, dateRange.dateFrom, dateRange.dateTo, Boolean(accessToken)],
    queryFn: () => portalApi.inboundReceipts(accessToken as string, { clientId: effectiveClientId, page, pageSize, dateRange }),
    enabled: Boolean(accessToken),
  });
}
