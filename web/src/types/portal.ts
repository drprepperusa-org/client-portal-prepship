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
  };
};

export type OrderStatus = 'awaiting_shipment' | 'shipped' | 'cancelled';

export type OrderItem = {
  sku?: string | null;
  name?: string | null;
  quantity?: number | string | null;
  unitPrice?: number | string | null;
};

export type PortalOrder = {
  id: number;
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
