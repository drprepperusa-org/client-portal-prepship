import type {
  BillingSummaryRow,
  AnalysisSkuBreakdown,
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
      clientName: 'Heritage Kids Press',
      orderStatus: 'awaiting_shipment',
      orderDate: '2026-05-25T03:18:00.000Z',
      shipToName: 'Ava Reynolds',
      shipToCity: 'Austin',
      shipToState: 'TX',
      carrierCode: 'usps',
      serviceCode: 'ground_advantage',
      orderTotal: 136.51,
      weightOz: 130,
      shippingAccount: 'Chase x7439',
      bestRateJson: {
        carrierCode: 'ups',
        serviceName: 'UPS Ground Saver',
        providerAccountNickname: 'Chase x7439',
        shipmentCost: 8.98,
      },
      items: [
        {
          sku: 'spanish-songbook-1',
          name: 'I Love to Sing in Spanish: Nursery Rhymes',
          quantity: 1,
          unitPrice: 34.99,
          imageUrl: 'https://images.unsplash.com/photo-1519682337058-a94d519337bc?auto=format&fit=crop&w=160&q=80',
        },
        {
          sku: 'spanish-series',
          name: 'My First Spanish Words Series',
          quantity: 1,
          unitPrice: 54.99,
          imageUrl: 'https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?auto=format&fit=crop&w=160&q=80',
        },
        {
          sku: 'chinese-traditional-series',
          name: 'My First Chinese Words Series',
          quantity: 2,
          unitPrice: 23.265,
          imageUrl: 'https://images.unsplash.com/photo-1495446815901-a7297e633e8d?auto=format&fit=crop&w=160&q=80',
        },
      ],
    },
    {
      id: 81014,
      orderNumber: 'DP-10464',
      clientName: 'KF Goods',
      orderStatus: 'shipped',
      orderDate: '2026-05-24T21:04:00.000Z',
      shipToName: 'Mason Carter',
      shipToCity: 'Phoenix',
      shipToState: 'AZ',
      orderTotal: 30.55,
      weightOz: 64,
      shippingAccount: 'GG6381',
      label: {
        trackingNumber: '9400111206213890000000',
        carrierCode: 'ups',
        serviceCode: 'UPS Ground Saver',
        labelUrl: 'https://example.com/demo-label.pdf',
        cost: 13.09,
      },
      items: [
        {
          sku: 'B0DLK1BK4R',
          name: 'KF GOODIES Korean Ramen Variety Pack',
          quantity: 1,
          unitPrice: 30.55,
          imageUrl: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?auto=format&fit=crop&w=160&q=80',
        },
      ],
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
      imageUrl: 'https://images.unsplash.com/photo-1587854692152-cbe660dbde88?auto=format&fit=crop&w=160&q=80',
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
      imageUrl: 'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?auto=format&fit=crop&w=160&q=80',
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

export const demoAnalysisSkuBreakdown: AnalysisSkuBreakdown = {
  totalSkus: 158,
  totalOrders: 1679,
  dateBuckets: [
    '2026-04-27',
    '2026-04-28',
    '2026-04-29',
    '2026-04-30',
    '2026-05-01',
    '2026-05-02',
    '2026-05-03',
    '2026-05-04',
    '2026-05-05',
    '2026-05-06',
    '2026-05-07',
    '2026-05-08',
    '2026-05-09',
    '2026-05-10',
    '2026-05-11',
    '2026-05-12',
    '2026-05-13',
    '2026-05-14',
    '2026-05-15',
    '2026-05-16',
    '2026-05-17',
    '2026-05-18',
    '2026-05-19',
    '2026-05-20',
    '2026-05-21',
    '2026-05-22',
    '2026-05-23',
    '2026-05-24',
    '2026-05-25',
    '2026-05-26',
  ],
  data: [
    { sku: 'SWICY_1P', name: 'Buldak Swicy Sweet & Spicy', client_name: 'Walmart - DJC', orders: 81, pending: 0, ext_shipped: 56, total_qty: 92, total_revenue: 911.28, total_shipping: 160.71, std_orders: 26, exp_orders: 0, imageUrl: 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?auto=format&fit=crop&w=80&q=80', daily_qty: [2,3,4,3,2,7,1,2,6,1,0,10,2,1,4,3,2,1,19,8,9,2,1,2,1,5,2,4,2,1] },
    { sku: 'B0DLK1BK4R', name: 'KF GOODIES Korean Ramen', client_name: 'KF Goods', orders: 85, pending: 1, ext_shipped: 31, total_qty: 87, total_revenue: 2665.92, total_shipping: 719.31, std_orders: 51, exp_orders: 4, imageUrl: 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?auto=format&fit=crop&w=80&q=80', daily_qty: [1,2,3,3,2,2,1,1,3,4,5,1,2,3,1,2,2,3,1,7,8,2,2,1,4,6,10,13,7,2] },
    { sku: 'tagalog-series', name: 'My First Tagalog Words', client_name: 'Heritage Kids Press', orders: 68, pending: 3, ext_shipped: 1, total_qty: 80, total_revenue: 2747.2, total_shipping: 272.2, std_orders: 76, exp_orders: 0, imageUrl: 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=80&q=80', daily_qty: [3,4,4,3,2,2,1,4,4,3,2,2,4,8,4,2,3,2,2,10,5,1,2,3,6,2,4,3,2,1] },
    { sku: 'SL-1GAL-1P', name: 'Soilove Stain Remover', client_name: 'Walmart - DJC', orders: 61, pending: 1, ext_shipped: 54, total_qty: 69, total_revenue: 1117.91, total_shipping: 48.47, std_orders: 8, exp_orders: 0, imageUrl: 'https://images.unsplash.com/photo-1583947215259-38e31be8751f?auto=format&fit=crop&w=80&q=80', daily_qty: [1,1,2,2,3,1,2,1,2,1,1,1,2,2,2,1,2,1,2,7,8,15,1,1,1,2,1,2,2,1] },
    { sku: 'tagalog-songbook-1', name: 'I Love to Sing in Tagalog', client_name: 'Heritage Kids Press', orders: 49, pending: 3, ext_shipped: 0, total_qty: 64, total_revenue: 1602.68, total_shipping: 127.46, std_orders: 61, exp_orders: 0, imageUrl: 'https://images.unsplash.com/photo-1519682337058-a94d519337bc?auto=format&fit=crop&w=80&q=80', daily_qty: [1,1,1,2,1,1,2,1,1,2,1,2,2,1,1,2,1,1,1,2,15,1,1,2,1,1,1,3,2,1] },
    { sku: 'B000BYO3K', name: 'Bacchus-D Energy Drink', client_name: 'Tran Agency', orders: 50, pending: 0, ext_shipped: 23, total_qty: 61, total_revenue: 1494.46, total_shipping: 292.07, std_orders: 32, exp_orders: 0, imageUrl: 'https://images.unsplash.com/photo-1622483767028-3f66f32aef97?auto=format&fit=crop&w=80&q=80', daily_qty: [2,1,2,3,2,1,2,1,3,2,1,4,3,2,2,1,2,4,2,3,2,4,3,2,3,2,1,2,2,1] },
    { sku: 'vietnamese-series', name: 'My First Vietnamese Series', client_name: 'Heritage Kids Press', orders: 59, pending: 3, ext_shipped: 0, total_qty: 59, total_revenue: 2112.41, total_shipping: 297.64, std_orders: 56, exp_orders: 0, imageUrl: 'https://images.unsplash.com/photo-1495446815901-a7297e633e8d?auto=format&fit=crop&w=80&q=80', daily_qty: [1,2,1,4,2,1,3,1,2,3,1,4,2,1,3,2,3,1,2,2,3,4,1,2,2,3,1,2,1,2] },
    { sku: 'B-6', name: 'Binggrae Milkis Soda', client_name: 'Walmart - DJC', orders: 53, pending: 1, ext_shipped: 29, total_qty: 58, total_revenue: 844.9, total_shipping: 191.5, std_orders: 25, exp_orders: 0, imageUrl: 'https://images.unsplash.com/photo-1581006852262-e4307cf6283a?auto=format&fit=crop&w=80&q=80', daily_qty: [1,2,2,1,1,3,2,2,1,3,1,2,4,3,2,1,2,5,4,3,2,1,3,1,2,2,1,1,2,1] },
    { sku: 'CREAM_CARB_5P', name: 'Samyang Buldak Cream Carbonara', client_name: 'Walmart - DJC', orders: 50, pending: 0, ext_shipped: 38, total_qty: 58, total_revenue: 827.42, total_shipping: 112.32, std_orders: 16, exp_orders: 0, imageUrl: 'https://images.unsplash.com/photo-1612929633738-8fe44f7ec841?auto=format&fit=crop&w=80&q=80', daily_qty: [2,1,2,1,3,2,1,1,2,2,1,3,2,4,3,2,2,1,3,2,2,2,1,3,2,2,1,2,1,1] },
    { sku: 'spanish-series', name: 'My First Spanish Series', client_name: 'Heritage Kids Press', orders: 54, pending: 5, ext_shipped: 8, total_qty: 56, total_revenue: 2015.44, total_shipping: 179.77, std_orders: 42, exp_orders: 0, imageUrl: 'https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?auto=format&fit=crop&w=80&q=80', daily_qty: [1,3,1,2,2,2,1,2,1,3,2,1,2,3,2,1,2,2,1,2,3,2,1,2,2,3,1,2,1,2] },
    { sku: 'B09H17XHVK', name: 'Binggrae Banana Milk', client_name: 'Tran Agency', orders: 48, pending: 1, ext_shipped: 40, total_qty: 54, total_revenue: 1968.28, total_shipping: 75.74, std_orders: 13, exp_orders: 0, imageUrl: 'https://images.unsplash.com/photo-1528750997573-59b89d56f4f7?auto=format&fit=crop&w=80&q=80', daily_qty: [1,1,2,2,1,1,2,1,1,2,1,3,2,1,1,2,1,1,2,1,2,1,2,2,1,1,2,1,2,1] },
    { sku: 'ANE-LAUNDRY-PRE-1P', name: 'Laundry Pre Treat Spray', client_name: 'Walmart Store', orders: 42, pending: 0, ext_shipped: 36, total_qty: 49, total_revenue: 646.51, total_shipping: 49.19, std_orders: 5, exp_orders: 0, imageUrl: 'https://images.unsplash.com/photo-1563453392212-326f5e854473?auto=format&fit=crop&w=80&q=80', daily_qty: [0,1,1,2,1,1,1,2,1,1,2,1,1,1,2,1,1,1,2,1,1,1,2,1,1,2,1,1,1,1] },
  ],
};
