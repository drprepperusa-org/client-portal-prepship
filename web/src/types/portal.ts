import type { Session, User } from '@supabase/supabase-js';

export type PortalSession = Session | null;
export type PortalUser = User | null;

export type Paginated<T> = {
  data: T[];
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    clientTotals?: Array<{ clientId: number; total: number }>;
  };
};

export type OrderStatus = 'awaiting_shipment' | 'shipped' | 'cancelled';

export type OrderItem = {
  sku?: string | null;
  name?: string | null;
  quantity?: number | string | null;
  unitPrice?: number | string | null;
  imageUrl?: string | null;
  image_url?: string | null;
  thumbnailUrl?: string | null;
  productImageUrl?: string | null;
};

export type PortalOrder = {
  id: number;
  clientId?: number | null;
  client_id?: number | null;
  clientName?: string | null;
  client_name?: string | null;
  storeId?: number | string | null;
  store_id?: number | string | null;
  orderNumber?: string | null;
  externalOrderId?: string | null;
  sourceProvider?: string | null;
  sourceStoreId?: string | null;
  orderStatus?: string | null;
  orderDate?: string | null;
  shipToName?: string | null;
  shipToCity?: string | null;
  shipToState?: string | null;
  carrierCode?: string | null;
  serviceCode?: string | null;
  trackingNumber?: string | null;
  labelTracking?: string | null;
  items?: OrderItem[] | null;
  label?: {
    trackingNumber?: string | null;
    labelTracking?: string | null;
    labelUrl?: string | null;
    carrierCode?: string | null;
    serviceCode?: string | null;
  } | null;
};

export type PortalShipment = {
  id: number;
  orderId?: number | null;
  orderNumber?: string | null;
  clientId?: number | null;
  clientName?: string | null;
  storeId?: number | string | null;
  storeName?: string | null;
  carrierCode?: string | null;
  serviceCode?: string | null;
  trackingNumber?: string | null;
  labelTracking?: string | null;
  labelUrl?: string | null;
  shipDate?: string | null;
  voided?: boolean | null;
};

export type PortalInventoryItem = {
  id: number;
  clientId?: number | null;
  clientName?: string | null;
  storeIds?: Array<string | number> | null;
  storeName?: string | null;
  sku?: string | null;
  name?: string | null;
  stockQty?: number | string | null;
  reorderLevel?: number | string | null;
  active?: boolean | null;
  imageUrl?: string | null;
  soldLast30Days?: number | string | null;
  effectiveStock?: number | string | null;
  updatedAt?: string | null;
};

export type DashboardSummary = {
  revenue?: number;
  units?: number;
  bySku?: Array<{ sku: string; units30?: number; units7?: number; revenue?: number }>;
  dailyRevenue?: Array<{ day: string; revenue: number }>;
};

export type AnalysisSkuRow = {
  sku: string;
  name?: string | null;
  inv_sku_id?: number | string | null;
  invSkuId?: number | string | null;
  image_url?: string | null;
  imageUrl?: string | null;
  client_name?: string | null;
  clientName?: string | null;
  orders?: number | string | null;
  pending?: number | string | null;
  ext_shipped?: number | string | null;
  total_qty?: number | string | null;
  total_revenue?: number | string | null;
  total_shipping?: number | string | null;
  std_orders?: number | string | null;
  exp_orders?: number | string | null;
  daily_qty?: number[];
};

export type AnalysisSkuBreakdown = {
  data: AnalysisSkuRow[];
  dateBuckets?: string[];
  totalSkus?: number;
  totalOrders?: number;
};

export type AnalysisSkuOrder = {
  order_id?: number;
  orderId?: number;
  order_number?: string | null;
  orderNumber?: string | null;
  order_date?: string | null;
  orderDate?: string | null;
  order_status?: string | null;
  orderStatus?: string | null;
  ship_to_name?: string | null;
  shipToName?: string | null;
  qty?: number | string | null;
  unit_price?: number | string | null;
  unitPrice?: number | string | null;
  shipping_cost?: number | string | null;
  shippingCost?: number | string | null;
  standard_shipping_cost?: number | string | null;
  standardShippingCost?: number | string | null;
  is_external_shipped?: boolean | null;
  isExternalShipped?: boolean | null;
};

export type AnalysisSkuOrdersResponse = {
  sku: string;
  name?: string | null;
  totalUnits: number;
  standardShipCount: number;
  standardShippingTotal: number | string;
  avgStandardShippingCost: number | string;
  dailySales: Array<{ day: string; units: number | string }>;
  orders: AnalysisSkuOrder[];
};

export type BillingSummaryRow = {
  clientId?: number;
  clientName?: string;
  orderCount?: number;
  pickpackTotal?: number | string;
  additionalTotal?: number | string;
  packageTotal?: number | string;
  shippingTotal?: number | string;
  storageTotal?: number | string;
  grandTotal?: number | string;
};

export type PortalClient = {
  id?: number;
  name?: string | null;
  email?: string | null;
  active?: boolean | null;
  storeIds?: Array<string | number> | null;
};

export type PortalSetting = {
  key?: string;
  value?: string | null;
  updatedAt?: string | null;
};

export type CarrierAccount = {
  id?: number;
  clientId?: number | null;
  clientName?: string | null;
  storeName?: string | null;
  storeIds?: Array<string | number> | null;
  assignedClientIds?: number[];
  provider?: string | null;
  label?: string | null;
  accountIdentifier?: string | null;
  account_identifier?: string | null;
  source?: string | null;
  active?: boolean | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type StorePlatformCategory =
  | 'Direct-to-consumer'
  | 'Marketplaces'
  | 'Social commerce'
  | 'Retail / Wholesale';

export type CredentialField = {
  key: string;
  label: string;
  type?: 'text' | 'password' | 'url';
  placeholder?: string;
  required?: boolean;
};

export type StorePlatform = {
  id: string;
  provider: string;
  aliases?: string[];
  name: string;
  category: StorePlatformCategory;
  description: string;
  logoText: string;
  logoClass: string;
  accountLabel: string;
  accountPlaceholder: string;
  credentialFields: CredentialField[];
};

export type StoreConnectionWizardStep = 'platforms' | 'setup' | 'review';

export type StoreConnectionDraft = {
  id?: number;
  platformId: string;
  provider: string;
  label: string;
  accountIdentifier: string;
  credentials: Record<string, string>;
};
