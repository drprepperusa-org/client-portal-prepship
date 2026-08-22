import type { SkuOrdersResult } from '../src/services/sku-orders';

process.env.DATABASE_URL ??= 'postgres://ci:ci@localhost:5432/ci';
process.env.SUPABASE_URL ??= 'http://localhost:54321';
process.env.SUPABASE_ANON_KEY ??= 'ci';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'ci';
process.env.SUPABASE_JWT_SECRET ??= 'ci-secret';

const { toClientAnalysisSkuOrdersDto } = await import('../src/routes/client-portal/analysis');

const source = {
  sku: 'SKU-050',
  name: 'Customer item',
  clientId: 50,
  totalUnits: 3,
  shipCountStandard: 1,
  shipCountExpedited: 1,
  shippingStandardTotal: '6.00',
  shippingExpeditedTotal: '20.00',
  avgShippingStandard: '3.00',
  avgShippingExpedited: '10.00',
  dailySales: [
    { day: '2026-07-13', units: 1, future_daily_debug: 'blocked' },
    { day: '2026-07-14', units: 2, future_daily_debug: 'blocked' },
  ],
  future_internal_field: 'blocked',
  orders: [
    {
      order_id: 50,
      order_number: 'CP-050',
      order_date: '2026-07-14T00:00:00.000Z',
      order_status: 'shipped',
      ship_to_name: 'Customer',
      carrier_code: 'internal-carrier',
      service_code: 'internal-service',
      qty: 2,
      unit_price: '12.00',
      item_name: 'Customer item',
      shipping_cost: '3.00',
      shipping_total: '26.00',
      shipping_reconciled: null,
      shipping_standard: '6.00',
      shipping_expedited: '20.00',
      shipping_money_state: 'attributed',
      is_external_shipped: true,
      future_order_debug: 'blocked',
    },
  ],
} as SkuOrdersResult;

const dto = toClientAnalysisSkuOrdersDto(source);
const expectedTopLevel = [
  'sku',
  'name',
  'totalUnits',
  'avgShippingStandard',
  'avgShippingExpedited',
  'averageUnitsPerDay',
  'dailySales',
  'orders',
];
const expectedOrder = [
  'order_id',
  'order_number',
  'order_date',
  'order_status',
  'ship_to_name',
  'qty',
  'unit_price',
  'item_name',
  'shippingTotal',
  'shippingReconciled',
  'shippingStandard',
  'shippingExpedited',
  'shippingMoneyState',
];
const forbidden = [
  'clientId',
  'shipCountStandard',
  'shipCountExpedited',
  'shippingStandardTotal',
  'shippingExpeditedTotal',
  // Pre-CP-060 std-only fields under generic names: retired, must not return.
  'shippingCharge',
  'avgShippingCharge',
  'carrier_code',
  'service_code',
  'shipping_cost',
  'shipping_total',
  'standard_shipping_cost',
  'standard_shipping_total',
  'is_external_shipped',
  'future_internal_field',
  'future_daily_debug',
  'future_order_debug',
];

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
  } else if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      keys.add(key);
      collectKeys(nested, keys);
    }
  }
  return keys;
}

assert(JSON.stringify(Object.keys(dto)) === JSON.stringify(expectedTopLevel), 'top-level DTO whitelist drifted');
assert(JSON.stringify(Object.keys(dto.orders[0] ?? {})) === JSON.stringify(expectedOrder), 'order DTO whitelist drifted');
assert(
  JSON.stringify(Object.keys(dto.dailySales[0] ?? {})) === JSON.stringify(['day', 'units']),
  'daily sales DTO whitelist drifted',
);
assert(dto.averageUnitsPerDay === 1.5, 'backend average-units formula drifted');
assert(dto.orders[0]?.shippingMoneyState === 'attributed', 'shippingMoneyState must cross the DTO boundary');
const emittedKeys = collectKeys(dto);
assert(forbidden.every((field) => !emittedKeys.has(field)), 'forbidden or future shared field crossed DTO boundary');

console.log('PASS CP-050/CP-060 Analysis SKU-orders DTO runtime whitelist');
