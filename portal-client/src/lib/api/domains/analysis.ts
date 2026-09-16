import type { RequestAuth } from '../transport';
import type { AnalysisBreakdown, AnalysisListOptions, SkuOrdersResult } from '@client-portal-contracts/analysis';
import type { PortalDateRange } from '@client-portal-contracts/common';
import { dashboardRangeParams } from '../scope';
import { apiGet } from '../transport';

export const analysisApi = {
  analysis: (token: RequestAuth, range: PortalDateRange, clientId?: number, options: AnalysisListOptions = {}) =>
    apiGet<AnalysisBreakdown>(token, '/api/client-portal/analysis', {
      ...dashboardRangeParams(range),
      ...options,
      clientId,
    }),
  skuOrders: (
    token: RequestAuth,
    inventoryId: number,
    dateFrom?: string,
    dateTo?: string,
    clientId?: number,
    page = 1,
    pageSize = 50,
  ) =>
    apiGet<SkuOrdersResult>(token, '/api/client-portal/analysis/sku-orders', {
      inventoryId,
      ...(dateFrom && dateTo ? dashboardRangeParams({ dateFrom, dateTo }) : { dateFrom, dateTo }),
      clientId,
      page,
      pageSize,
    }),
};
