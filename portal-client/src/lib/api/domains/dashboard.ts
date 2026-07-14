import type { PortalDateRange } from '@client-portal-contracts/common';
import type { DailyCount, DashboardSummary } from '@client-portal-contracts/dashboard';
import { apiGet } from '../transport';
import { dailyRangeParams, dashboardRangeParams } from '../scope';

function dashboard(token: string, range: PortalDateRange, clientId?: number) {
  return apiGet<DashboardSummary>(token, '/api/client-portal/dashboard', {
    ...dashboardRangeParams(range),
    clientId,
  });
}

function dailyCounts(token: string, range: PortalDateRange, clientId?: number) {
  return apiGet<{ data: DailyCount[] }>(token, '/api/client-portal/daily-counts', {
    ...dailyRangeParams(range),
    clientId,
  });
}

export const dashboardApi = {
  dashboard,
  dailyCounts,
  backgroundDashboard: dashboard,
  backgroundDailyCounts: dailyCounts,
  dailyShipments: (token: string, range: PortalDateRange, clientId?: number) =>
    apiGet<{ data: Array<{ day: string; shipments: number }> }>(
      token,
      '/api/client-portal/daily-shipments',
      { ...dashboardRangeParams(range), clientId },
    ),
};
