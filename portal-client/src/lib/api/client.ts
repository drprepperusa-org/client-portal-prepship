import { accessApi } from './domains/access';
import { analysisApi } from './domains/analysis';
import { billingApi } from './domains/billing';
import { connectionsApi } from './domains/connections';
import { dashboardApi } from './domains/dashboard';
import { inboundApi } from './domains/inbound';
import { inventoryApi } from './domains/inventory';
import { ordersApi } from './domains/orders';
import { returnsApi } from './domains/returns';
import { replacementsApi } from './domains/replacements';
import { shipmentsApi } from './domains/shipments';

export const portalApi = {
  ...accessApi,
  ...dashboardApi,
  ...ordersApi,
  ...shipmentsApi,
  ...inventoryApi,
  ...returnsApi,
  ...replacementsApi,
  ...connectionsApi,
  ...inboundApi,
  ...analysisApi,
  ...billingApi,
};
