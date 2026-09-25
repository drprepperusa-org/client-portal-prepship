import { expect, test } from '@playwright/test';

// Production chunks, deterministic auth/API fixtures, no external requests.
const baseline = process.env.DASHBOARD_PERF_BASELINE === '1';
const browserErrors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = [];
  browserErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
});
test.afterEach(async ({ page }, info) => {
  if (!info.title.startsWith('failed chart download')) expect(browserErrors.get(page)).toEqual([]);
});

test('signed-out entry does not fetch chart code', async ({ page }) => {
  const charts = [];
  page.on('request', request => { if (/\/assets\/charts-[^/]+\.js/.test(request.url())) charts.push(request.url()); });
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:5178' ? route.continue() : route.abort());
  for (const url of ['/', '/inventory', '/analysis', '/billing']) {
    await page.goto(url, { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  }
  if (baseline) expect(charts.length).toBeGreaterThan(0);
  else expect(charts).toHaveLength(0);
});

test('failed chart download preserves KPIs and can recover with reload', async ({ page }) => {
  test.skip(baseline, 'Regression for the new isolated chart loading boundary');
  await setup(page);
  let fail = true;
  await page.route('**/assets/charts-*.js', route => fail ? route.abort() : route.continue());
  await page.goto('/', { waitUntil: 'commit' });
  await expect(page.getByRole('alert').first()).toContainText('Chart could not load');
  await expect(page.getByRole('button', { name: 'Open orders: 7. View live details', exact: true })).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Reload chart', exact: true }).first().click();
  await expect(page.getByRole('figure', { name: 'Orders count and unit count by day', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
const metric = value => ({ value, periodTotal: value, dailyAverage: value, periodSharePercent: 100,
  vsDailyAveragePercent: 0, busiestRank: 1, periodDayCount: 1 });
const dashboard = {
  revenue: 100, units: 23, openOrderCount: 7,
  bySku: [{ sku: 'FIXTURE-SKU', units30: 23, revenue: 100, avgShippingPrice: 2 }],
  period: { dayCount: 1, orderedOrderCount: 11, orderedUnitCount: 23, allOrderCount: 11,
    awaitingOrderCount: 7, shippedOrderCount: 4, cancelledOrderCount: 0, shipmentCount: 5,
    averageShippedOrdersPerDay: 4, peakShippedOrderCount: 4 },
  daily: [{ day: '2026-09-17', orderedOrders: metric(11), orderedUnits: metric(23),
    allOrders: metric(11), awaitingOrders: metric(7), shippedOrders: metric(4),
    cancelledOrders: metric(0), shipmentsCreated: metric(5), unitsPerOrder: 23 / 11 }],
};

async function setup(page, { hidden = [], empty = false, analysisEmpty = false } = {}) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const user = { id: 'dashboard-loading', aud: 'authenticated', role: 'authenticated', email: 'fixture@example.test',
    app_metadata: { role: 'admin', permissions: ['scope:global'] }, user_metadata: {} };
  const token = [encode({ alg: 'HS256', typ: 'JWT' }), encode({ ...user, sub: user.id, exp: 4102444800 }), 'fixture'].join('.');
  await page.addInitScript(({ user, token, hidden }) => {
    localStorage.setItem('sb-portal-e2e-auth-token', JSON.stringify({ access_token: token, refresh_token: 'fixture',
      expires_at: 4102444800, expires_in: 2147483647, token_type: 'bearer', user }));
    localStorage.setItem(`prepship.dashLayout.${user.id}`, JSON.stringify({ hidden }));
  }, { user, token, hidden });
  const requests = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/client-portal/')) {
      requests.push(url.pathname);
      const body = url.pathname.endsWith('/analysis') ? analysisFixture(analysisEmpty) :
        url.pathname.endsWith('/analysis/sku-orders') ? skuFixture :
        url.pathname.endsWith('/dashboard') ? { ...dashboard, ...(empty ? { daily: [] } : {}) } :
        url.pathname.endsWith('/me') ? { ...user, isAdmin: true, isGlobal: true, isRestricted: false,
          canViewFinancials: true, canCustomizeTables: true, clientIds: [], storeIds: [] } :
        url.pathname.endsWith('/clients') ? { data: [{ id: 1, name: 'Alpha' }] } :
        url.pathname.endsWith('/awaiting-active-count') ? { count: 7 } : { data: [] };
      await route.fulfill({ json: body }); return;
    }
    if (url.origin === 'http://127.0.0.1:5178') { await route.continue(); return; }
    await route.abort();
  });
  return requests;
}

const analysisBaseline = process.env.ANALYSIS_PERF_BASELINE === '1';
const sku = { sku: 'ANALYSIS-SKU', name: 'Analysis fixture item', inv_sku_id: 1, client_id: 1,
  client_name: 'Alpha', orders: 4, pending: 0, total_qty: 23, total_revenue: '100', daily_qty: [23] };
const analysisFixture = empty => ({ data: empty ? [] : [sku], topSkus: empty ? [] : [sku],
  dateBuckets: ['2026-09-17'], totalSkus: empty ? 0 : 1, totalOrders: empty ? 0 : 4,
  totalUnits: empty ? 0 : 23, totalRevenue: empty ? 0 : 100, orderCombinations: [],
  pagination: { page: 1, pageSize: 50, total: empty ? 0 : 1, totalPages: 1 } });
const skuFixture = { sku: sku.sku, totalUnits: 23, averageUnitsPerDay: 23,
  avgShippingStandard: '2', avgShippingExpedited: '0', dailySales: [{ day: '2026-09-17', units: 23 }],
  orders: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 } };

test('Analysis data, search and SKU details do not wait for charts', async ({ page }, info) => {
  const requests = await setup(page);
  let held;
  await page.route('**/assets/charts-*.js', route => { held = route; });
  await page.goto('/analysis', { waitUntil: 'commit' });
  await expect.poll(() => Boolean(held)).toBe(true);
  const search = page.getByRole('textbox', { name: 'Search Analysis SKUs' });
  const row = page.getByRole('button', { name: 'View SKU details for ANALYSIS-SKU', exact: true });
  if (analysisBaseline) await page.waitForTimeout(1000);
  else await expect(row).toBeVisible();
  const result = { searchVisibleBeforeChartRelease: await search.isVisible(),
    analysisRequestedBeforeChartRelease: requests.includes('/api/client-portal/analysis') };
  console.log(JSON.stringify(result));
  await info.attach('analysis-chart-dependency', { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result.searchVisibleBeforeChartRelease).toBe(!analysisBaseline);
  expect(result.analysisRequestedBeforeChartRelease).toBe(!analysisBaseline);
  if (!analysisBaseline) {
    await row.click();
    const drawer = page.getByRole('dialog', { name: sku.name, exact: true });
    await expect(drawer.getByText('Avg std shipping', { exact: true })).toBeVisible();
    await expect(drawer.getByText('$2.00', { exact: true })).toBeVisible();
    expect(requests).toContain('/api/client-portal/analysis/sku-orders');
    await page.getByRole('button', { name: 'Close panel', exact: true }).click();
  }
  await held.continue();
  const trend = page.getByRole('figure', { name: 'Daily units sold for top SKUs', exact: true });
  await expect(trend).toBeVisible();
  await trend.getByText('View chart data', { exact: true }).click();
  await expect(trend.getByRole('cell', { name: '23', exact: true })).toBeVisible();
  await row.click();
  const chart = page.getByRole('figure', { name: 'Units sold for selected SKU', exact: true });
  await expect(chart).toBeVisible();
  await chart.getByText('View chart data', { exact: true }).click();
  await expect(chart.getByRole('cell', { name: '23', exact: true })).toBeVisible();
});

test('empty Analysis does not download chart code', async ({ page }) => {
  await setup(page, { analysisEmpty: true });
  const charts = [];
  page.on('request', request => { if (/\/assets\/charts-[^/]+\.js/.test(request.url())) charts.push(request.url()); });
  await page.goto('/analysis', { waitUntil: 'networkidle' });
  await expect(page.getByText('No sales data', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Search Analysis SKUs' })).toBeVisible();
  console.log(JSON.stringify({ analysisEmptyChartRequests: charts.length }));
  expect(charts).toHaveLength(analysisBaseline ? 1 : 0);
});

test('failed chart download on Analysis preserves the table and recovers on reload', async ({ page }) => {
  test.skip(analysisBaseline, 'The baseline has no isolated Analysis chart boundary');
  await setup(page);
  let fail = true;
  await page.route('**/assets/charts-*.js', route => fail ? route.abort() : route.continue());
  await page.goto('/analysis', { waitUntil: 'commit' });
  await expect(page.getByRole('alert').first()).toContainText('Chart could not load');
  await expect(page.getByRole('button', { name: 'View SKU details for ANALYSIS-SKU', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search Analysis SKUs' }).fill('ANALYSIS');
  await expect(page.getByRole('textbox', { name: 'Search Analysis SKUs' })).toHaveValue('ANALYSIS');
  fail = false;
  await page.getByRole('button', { name: 'Reload chart', exact: true }).first().click();
  await expect(page.getByRole('figure', { name: 'Daily units sold for top SKUs', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('KPI data and controls do not wait for the chart library', async ({ page }, info) => {
  const requests = await setup(page);
  let held;
  await page.route('**/assets/charts-*.js', route => { held = route; });
  await page.goto('/', { waitUntil: 'commit' });
  await expect.poll(() => Boolean(held)).toBe(true);
  const kpi = page.getByRole('button', { name: 'Open orders: 7. View live details', exact: true });
  // A controlled unresolved chunk proves dependency order, not a noisy machine-speed threshold.
  if (!baseline) await expect(kpi).toBeVisible();
  else await page.waitForTimeout(1000);
  const result = { kpiVisibleBeforeChartRelease: await kpi.isVisible(),
    dashboardRequestedBeforeChartRelease: requests.includes('/api/client-portal/dashboard') };
  console.log(JSON.stringify(result));
  await info.attach('chart-dependency-measurement', { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result.kpiVisibleBeforeChartRelease).toBe(!baseline);
  expect(result.dashboardRequestedBeforeChartRelease).toBe(!baseline);
  await held.continue();
  await expect(kpi).toBeVisible();
  const orders = page.getByRole('figure', { name: 'Orders count and unit count by day', exact: true });
  await expect(orders).toBeVisible();
  await orders.getByText('View chart data', { exact: true }).click();
  await expect(orders.getByRole('cell', { name: '23', exact: true })).toBeVisible();
  await orders.getByRole('combobox').selectOption('2026-09-17');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await kpi.click();
  await expect(page.getByRole('dialog', { name: 'Open orders', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'KPI trend by day' })).toBeVisible();
});

for (const scenario of ['hidden', 'empty']) {
  test(`${scenario} dashboard charts do not download the chart library`, async ({ page }) => {
    await setup(page, scenario === 'hidden' ? { hidden: ['ordersChart', 'volumeChart'] } : { empty: true });
    const chartRequests = [];
    page.on('request', request => { if (/\/assets\/charts-[^/]+\.js/.test(request.url())) chartRequests.push(request.url()); });
    await page.goto('/', { waitUntil: 'networkidle' });
    const kpi = page.getByRole('button', { name: 'Open orders: 7. View live details', exact: true });
    await expect(kpi).toBeVisible();
    console.log(JSON.stringify({ scenario, chartRequests: chartRequests.length }));
    expect(chartRequests).toHaveLength(baseline ? 1 : 0);
    // Hidden main charts do not prevent an explicitly requested KPI trend from loading.
    await kpi.click();
    await expect(page.getByRole('group', { name: 'KPI trend by day' })).toBeVisible();
    expect(chartRequests).toHaveLength(1);
  });
}
