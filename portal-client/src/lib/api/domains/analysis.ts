import type { AnalysisBreakdown, SkuOrdersResult } from '@client-portal-contracts/analysis';
import type { PortalDateRange } from '@client-portal-contracts/common';
import { dashboardRangeParams } from '../scope';
import { apiGet } from '../transport';

export const analysisApi = {
  analysis: (token: string, range: PortalDateRange, clientId?: number) =>
    apiGet<AnalysisBreakdown>(token, '/api/client-portal/analysis', {
      ...dashboardRangeParams(range),
      limit: 200,
      clientId,
    }),
  skuOrders: (
    token: string,
    inventoryId: number,
    dateFrom?: string,
    dateTo?: string,
  ) =>
    apiGet<SkuOrdersResult>(token, '/api/client-portal/analysis/sku-orders', {
      inventoryId,
      dateFrom,
      dateTo,
    }),
};
