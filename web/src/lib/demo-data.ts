import type {
  BillingSummaryRow,
  DashboardSummary,
  Paginated,
  PortalInventoryItem,
  PortalOrder,
  PortalShipment,
} from '../types/portal';

export const DEMO_TOKEN = 'portal-demo-token';

export const demoDashboard: DashboardSummary = {
  revenue: 0,
  units: 428,
  bySku: [
    { sku: 'DRP-READY-01', units30: 148, units7: 34 },
    { sku: 'DRP-FILTER-12', units30: 91, units7: 21 },
    { sku: 'DRP-PACK-A', units30: 76, units7: 19 },
  ],
  dailyRevenue: [
    { day: '2026-05-19', revenue: 0 },
    { day: '2026-05-20', revenue: 0 },
    { day: '2026-05-21', revenue: 0 },
    { day: '2026-05-22', revenue: 0 },
    { day: '2026-05-23', revenue: 0 },
    { day: '2026-05-24', revenue: 0 },
    { day: '2026-05-25', revenue: 0 },
  ],
};

export const demoDailyCounts = {
  data: [
    { day: '2026-05-19', awaiting: 12, shipped: 28, cancelled: 1, total: 41 },
    { day: '2026-05-20', awaiting: 9, shipped: 34, cancelled: 0, total: 43 },
    { day: '2026-05-21', awaiting: 15, shipped: 31, cancelled: 2, total: 48 },
    { day: '2026-05-22', awaiting: 7, shipped: 39, cancelled: 0, total: 46 },
  ],
};

export const demoOrders: Paginated<PortalOrder> = {
  data: [
    {
      id: 81041,
      orderNumber: 'DP-10491',
      orderStatus: 'awaiting_shipment',
      orderDate: '2026-05-25T03:18:00.000Z',
      shipToName: 'Ava Reynolds',
      shipToCity: 'Austin',
      shipToState: 'TX',
      carrierCode: 'usps',
      serviceCode: 'ground_advantage',
      items: [{ sku: 'DRP-READY-01', name: 'Ready Kit', quantity: 2 }],
    },
    {
      id: 81014,
      orderNumber: 'DP-10464',
      orderStatus: 'shipped',
      orderDate: '2026-05-24T21:04:00.000Z',
      shipToName: 'Mason Carter',
      shipToCity: 'Phoenix',
      shipToState: 'AZ',
      label: {
        trackingNumber: '9400111206213890000000',
        carrierCode: 'usps',
        serviceCode: 'priority',
        labelUrl: 'https://example.com/demo-label.pdf',
      },
      items: [{ sku: 'DRP-FILTER-12', name: 'Filter Pack', quantity: 1 }],
    },
  ],
  pagination: { page: 1, pageSize: 25, total: 2, totalPages: 1 },
};

export const demoShipments: Paginated<PortalShipment> = {
  data: [
    {
      id: 1205,
      orderId: 81014,
      orderNumber: 'DP-10464',
      carrierCode: 'usps',
      serviceCode: 'priority',
      trackingNumber: '9400111206213890000000',
      labelUrl: 'https://example.com/demo-label.pdf',
      shipDate: '2026-05-24T23:12:00.000Z',
      voided: false,
    },
  ],
  pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
};

export const demoInventory: Paginated<PortalInventoryItem> = {
  data: [
    {
      id: 44,
      sku: 'DRP-READY-01',
      name: 'Ready Kit',
      stockQty: 326,
      reorderLevel: 100,
      active: true,
      soldLast30Days: 148,
      updatedAt: '2026-05-25T02:00:00.000Z',
    },
    {
      id: 45,
      sku: 'DRP-FILTER-12',
      name: 'Filter Pack',
      stockQty: 54,
      reorderLevel: 80,
      active: true,
      soldLast30Days: 91,
      updatedAt: '2026-05-25T02:00:00.000Z',
    },
  ],
  pagination: { page: 1, pageSize: 25, total: 2, totalPages: 1 },
};

export const demoBilling: { data: BillingSummaryRow[]; grandTotal: number } = {
  data: [
    {
      clientId: 7,
      clientName: 'DrPrepperUSA',
      orderCount: 184,
      pickpackTotal: 736,
      additionalTotal: 112,
      packageTotal: 281,
      shippingTotal: 0,
      storageTotal: 49,
      grandTotal: 1178,
    },
  ],
  grandTotal: 1178,
};
