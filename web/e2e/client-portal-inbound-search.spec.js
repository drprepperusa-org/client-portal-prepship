import { expect, test } from '@playwright/test';
const base = 'http://127.0.0.1:5177';
test.use({ contextOptions: { reducedMotion: 'reduce' } });
async function fixture(page) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const user = { id: 'inbound-search-user', email: 'search@example.test', aud: 'authenticated', role: 'authenticated',
    app_metadata: { role: 'admin', permissions: ['scope:global'] }, user_metadata: {} };
  const session = { access_token: [encode({ alg: 'HS256', typ: 'JWT' }), encode({ ...user, sub: user.id, exp: 4102444800 }), 'fixture'].join('.'),
    refresh_token: 'fixture', expires_at: 4102444800, expires_in: 2147483647, token_type: 'bearer', user };
  await page.addInitScript(s => localStorage.setItem('sb-portal-e2e-auth-token', JSON.stringify(s)), session);
  const state = { requests: [], errors: [], fail: false, release: null, held: null };
  page.on('pageerror', error => state.errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (!path.startsWith('/api/client-portal/')) {
      if (url.origin === base) await route.continue(); else await route.abort();
      return;
    }
    let body = { data: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 } };
    if (path.endsWith('/me')) body = { ...user, isAdmin: true, isGlobal: true, isRestricted: false, clientIds: [], storeIds: [] };
    if (path.endsWith('/clients')) body = { data: [{ id: 1, name: 'Client One' }, { id: 2, name: 'Client Two' }] };
    if (path.endsWith('/inbound')) {
      expect(route.request().method()).toBe('GET');
      const q = Object.fromEntries(url.searchParams); state.requests.push(q);
      if (q.search === 'held') { state.held = true; await new Promise(resolve => { state.release = resolve; }); }
      if (state.fail) { await route.fulfill({ status: 503, json: { error: 'Search temporarily unavailable' } }); return; }
      const noMatch = q.search === 'missing';
      const total = noMatch ? 0 : q.search ? 1 : 125;
      const pageSize = Number(q.pageSize), current = Number(q.page);
      const id = current * 100 + Number(q.clientId ?? 1);
      body = { data: noMatch ? [] : [{ id, reference: q.search ? `MATCH-${q.search}` : `PO-PAGE-${current}-CLIENT-${q.clientId ?? 'all'}`,
        clientId: Number(q.clientId ?? 1), clientName: 'Client One', status: q.status ?? 'expected',
        supplier: 'Fixture supplier', carrier: null, trackingNumber: 'TRACK-FOUND', expectedDate: null, receivedDate: null, notes: null,
        createdAt: '2026-09-23T00:00:00Z', expectedUnits: 12, receivedUnits: 0,
        items: [{ id: 1, sku: 'SKU-OLD', name: 'Full shipment item', expectedQty: 12, receivedQty: 0 }] }],
      pagination: { page: current, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
    }
    await route.fulfill({ json: body });
  });
  await page.goto(base + '/inbound');
  const region = page.getByRole('region', { name: 'Expected shipments', exact: true });
  await expect(region.getByText('PO-PAGE-1-CLIENT-all', { exact: true }).filter({ visible: true })).toBeVisible();
  return { state, region };
}
test('Expected shipment search, status and page size query the server and reset pagination independently', async ({ page }) => {
  const { state, region } = await fixture(page);
  await region.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(region.getByText('PO-PAGE-2-CLIENT-all').filter({ visible: true })).toBeVisible();
  await region.getByLabel('Search shipments', { exact: true }).fill('SKU-OLD');
  await expect(region.getByText('MATCH-SKU-OLD', { exact: true }).filter({ visible: true })).toBeVisible();
  expect(state.requests.at(-1)).toMatchObject({ search: 'SKU-OLD', page: '1', pageSize: '50' });
  await region.getByRole('button', { name: 'View inbound MATCH-SKU-OLD', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('Full shipment item · SKU-OLD')).toBeVisible();
  await page.keyboard.press('Escape');
  await region.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(region.getByText('PO-PAGE-1-CLIENT-all').filter({ visible: true })).toBeVisible();
  for (const status of ['in_transit', 'received', 'cancelled', 'expected']) {
    await region.getByRole('button', { name: 'Next page', exact: true }).click();
    await expect(region.getByText('PO-PAGE-2-CLIENT-all').filter({ visible: true })).toBeVisible();
    await region.getByLabel('Shipment status', { exact: true }).selectOption(status);
    await expect.poll(() => state.requests.at(-1)).toMatchObject({ page: '1', status });
    await expect(region.getByText('PO-PAGE-1-CLIENT-all').filter({ visible: true })).toBeVisible();
  }
  await region.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(region.getByText('PO-PAGE-2-CLIENT-all').filter({ visible: true })).toBeVisible();
  await region.getByLabel('Rows per page', { exact: true }).selectOption('100');
  await expect.poll(() => state.requests.at(-1)).toMatchObject({ page: '1', pageSize: '100' });
  await page.getByLabel('Filter by client', { exact: true }).selectOption('2');
  await expect(region.getByText('PO-PAGE-1-CLIENT-2').filter({ visible: true })).toBeVisible();
  expect(state.requests.at(-1)).toMatchObject({ page: '1', clientId: '2' });
  expect(state.errors).toEqual([]);
});
test('Empty search can clear, failed searches retry, and controls fit mobile', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { state, region } = await fixture(page);
  const input = region.getByLabel('Search shipments', { exact: true });
  await input.fill('missing'); await expect(region.getByText('No matching shipments')).toBeVisible();
  await region.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(region.getByText('PO-PAGE-1-CLIENT-all').filter({ visible: true })).toBeVisible();
  state.fail = true; await input.fill('retry');
  await expect(region.getByText("Couldn't load data")).toBeVisible({ timeout: 15000 });
  state.fail = false;
  await region.getByRole('button', { name: /try again|retry/i }).click();
  await expect(region.getByText('MATCH-retry', { exact: true }).filter({ visible: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('inbound-search-mobile.png'), fullPage: true });
  expect(state.errors).toEqual([]);
});
test('Late search response cannot replace newer results or another client scope', async ({ page }) => {
  const { state, region } = await fixture(page);
  const input = region.getByLabel('Search shipments', { exact: true });
  await input.fill('held'); await expect.poll(() => state.held).toBe(true);
  await input.fill('latest');
  await expect(region.getByText('MATCH-latest', { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByLabel('Filter by client', { exact: true }).selectOption('2');
  await expect(region.getByText('MATCH-latest', { exact: true }).filter({ visible: true })).toBeVisible();
  state.release();
  await expect(region.getByText('MATCH-held', { exact: true })).toHaveCount(0);
  expect(state.requests.at(-1)).toMatchObject({ search: 'latest', clientId: '2', page: '1' });
});
