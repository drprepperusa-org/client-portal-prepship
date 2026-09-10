import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/auth';
import { portalApi } from '@/lib/api';
import { usePortalFilters } from '@/lib/portalContext';

export function useInboundReceipts(clientId?: number, page = 1, pageSize = 50, sortBy?: string, sortDir?: 'asc' | 'desc') {
  const { accessToken } = useAuth();
  const { clientId: globalClientId } = usePortalFilters();
  const effectiveClientId = clientId ?? globalClientId;
  return useQuery({
    queryKey: ['inbound-receipts', effectiveClientId ?? 'scope', page, pageSize, sortBy, sortDir, Boolean(accessToken)],
    queryFn: () => portalApi.inboundReceipts(accessToken as string, { clientId: effectiveClientId, page, pageSize, sortBy, sortDir }),
    enabled: Boolean(accessToken),
  });
}
