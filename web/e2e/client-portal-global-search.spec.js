import { expect, test } from '@playwright/test';
const base = 'http://127.0.0.1:5177';
const categories = ['orders', 'shipments', 'inventory', 'returns', 'replacements'];
const titles = ['Orders', 'Shipments', 'Inventory', 'Returns', 'Replacements'];
test.use({ contextOptions: { reducedMotion: 'reduce' } });
const group = (page, title) => page.getByRole('region', { name: `${title} search results`, exact: true });
async function setup(page) {
  const state = { requests: [], failed: null, hold: null };
  const encode = v => Buffer.from(JSON.stringify(v)).toString('base64url');
  const user = { id: 'search-test', aud: 'authenticated', role: 'authenticated', email: 'search@portal-e2e.test',
    app_metadata: { role: 'admin', permissions: ['scope:global'] }, user_metadata: {} };
  const token = [encode({ alg: 'HS256', typ: 'JWT' }), encode({ ...user, sub: user.id, exp: 4102444800 }), 'fixture'].join('.');
  await page.addInitScript(session => localStorage.setItem('sb-portal-e2e-auth-token', JSON.stringify(session)), {
    access_token: token, refresh_token: 'fixture', expires_at: 4102444800, expires_in: 2147483647, token_type: 'bearer', user,
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/client-portal/')) {
      if (url.origin === base) await route.continue(); else await route.abort();
      return;
    }
    const name = url.pathname.split('/').at(-1);
    let body = { data: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 } };
    if (name === 'me') body = { ...user, isAdmin: true, isGlobal: true, isRestricted: false,
      canViewFinancials: true, canViewAudit: true, canRequestReplacements: true, clientIds: [], storeIds: [] };
    if (name === 'clients') body = { data: [{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }] };
    if (name === 'sync-status') body = { status: 'ok', lastSyncAt: null };
    if (name === 'awaiting-active-count') body = { count: 0 };
    if (categories.includes(name)) {
      const params = Object.fromEntries(url.searchParams);
      state.requests.push({ name, ...params });
      if (params.pageSize === '5') {
        if (state.hold && params.clientId === '1') await state.hold;
        if (state.failed === name) { await route.fulfill({ status: 503, json: { error: 'Unavailable' } }); return; }
        const marker = params.clientId === '1' ? 'Alpha' : params.clientId === '2' ? 'Beta' : 'All clients';
        const row = { id: 17, orderNumber: `ORDER-${marker}`, shipToName: `Customer ${marker}`, clientName: marker,
          fulfillmentStatus: 'shipped', shipmentStatus: 'shipped', displayTrackingNumber: 'TRACK-17',
          sku: 'SKU-17', name: `Product ${marker}`, returnReference: `RETURN-${marker}`, reference: `REPLACE-${marker}`, status: 'requested' };
        body = { data: params.search === 'empty' ? [] : [row],
          pagination: { page: 1, pageSize: 5, total: params.search === 'empty' ? 0 : 123, totalPages: 25 } };
      }
    }
    await route.fulfill({ json: body });
  });
  return state;
}

test('Global entry searches all five owners across statuses/dates and shows backend totals', async ({ page }) => {
  const state = await setup(page); await page.goto(base + '/search');
  await expect(page.getByRole('heading', { name: 'Search portal', exact: true })).toBeVisible();
  expect(state.requests).toHaveLength(0);
  await page.getByRole('searchbox', { name: 'Global search', exact: true }).fill('ABC & 17');
  await page.getByRole('searchbox', { name: 'Global search', exact: true }).press('Enter');
  for (const title of titles) await expect(group(page, title)).toContainText('123 matching records');
  expect(new Set(state.requests.map(r => r.name))).toEqual(new Set(categories));
  for (const request of state.requests) {
    expect(request).toMatchObject({ search: 'ABC & 17', page: '1', pageSize: '5' });
    for (const key of ['status', 'dateFrom', 'dateTo', 'clientId']) expect(request[key]).toBeUndefined();
  }
  await expect(group(page, 'Shipments')).toContainText('TRACK-17');
  const count = state.requests.filter(r => r.pageSize === '5').length;
  await page.getByRole('searchbox', { name: 'Search across portal' }).fill('draft only');
  await page.waitForTimeout(500);
  expect(state.requests.filter(r => r.pageSize === '5')).toHaveLength(count);
  await page.screenshot({ path: test.info().outputPath('portal-search-desktop.png') });
});

test('One failed category stays unavailable while other results and a category-only retry work', async ({ page }) => {
  const state = await setup(page); state.failed = 'shipments'; await page.goto(base + '/search?q=ABC');
  await expect(group(page, 'Orders')).toContainText('123 matching records');
  await expect(group(page, 'Shipments').getByRole('alert')).toContainText('search unavailable');
  await expect(group(page, 'Shipments')).not.toContainText('0 matching records');
  const others = state.requests.filter(r => r.name !== 'shipments').length;
  state.failed = null; await group(page, 'Shipments').getByRole('button', { name: 'Retry shipments' }).click();
  await expect(group(page, 'Shipments')).toContainText('123 matching records');
  expect(state.requests.filter(r => r.name !== 'shipments')).toHaveLength(others);
});

test('Client switch clears previous results and ignores a delayed response from another scope', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const state = await setup(page); await page.goto(base + '/search?q=ABC');
  await expect(group(page, 'Orders')).toContainText('ORDER-All clients');
  let release; state.hold = new Promise(resolve => { release = resolve; });
  await page.getByRole('button', { name: 'All clients', exact: true }).click();
  await page.getByRole('button', { name: 'Alpha', exact: true }).first().click();
  await expect.poll(() => new Set(state.requests.filter(r => r.clientId === '1').map(r => r.name)).size).toBe(5);
  await expect(page.getByText('ORDER-All clients', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Alpha', exact: true }).first().click();
  await page.getByRole('button', { name: 'Beta', exact: true }).click();
  for (const title of titles) await expect(group(page, title)).toContainText('Beta');
  release(); await page.waitForTimeout(200);
  for (const title of titles) await expect(group(page, title)).not.toContainText('Alpha');
});

for (const [index, path] of ['/orders', '/shipments', '/inventory', '/returns', '/replace'].entries()) {
  test(`${titles[index]} full-list link preserves encoded query and reload intent`, async ({ page }) => {
    const state = await setup(page); await page.goto(base + '/search?q=ABC%20%26%2017');
    await group(page, titles[index]).getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`${path}\\?`));
    expect(new URL(page.url()).searchParams.get('q')).toBe('ABC & 17');
    if (index === 0) expect(new URL(page.url()).searchParams.get('tab')).toBe('all');
    const latest = () => state.requests.filter(r => r.name === categories[index] && r.pageSize !== '5' && r.search).at(-1);
    await expect.poll(latest).toMatchObject({ search: 'ABC & 17', page: '1' });
    expect(latest().status).toBeUndefined();
    await expect(page.getByRole('textbox', { name: `Search ${categories[index]}`, exact: true })).toHaveValue('ABC & 17');
    await page.reload(); await expect.poll(latest).toMatchObject({ search: 'ABC & 17' });
    await page.goBack(); await expect(group(page, titles[index])).toContainText('123 matching records');
  });
}

test('Mobile entry, submitted-query history, empty results and invalid terms', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await setup(page); await page.goto(base + '/inventory');
  await page.getByRole('button', { name: 'Search portal', exact: true }).click();
  const input = page.getByRole('searchbox', { name: 'Search across portal' });
  await input.fill('ABC'); await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(group(page, 'Orders')).toContainText('123 matching records');
  await input.fill('empty'); await page.getByRole('button', { name: 'Search', exact: true }).click();
  for (const title of titles) await expect(group(page, title)).toContainText(`No matching ${title.toLowerCase()}.`);
  await page.goBack(); await expect(input).toHaveValue('ABC');
  await page.goForward(); await expect(input).toHaveValue('empty');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('portal-search-mobile.png') });
  const count = state.requests.filter(r => r.pageSize === '5').length;
  await page.goto(base + '/search?q=x'); await expect(input).toHaveValue('x');
  await expect(page.getByRole('button', { name: 'Search', exact: true })).toBeDisabled();
  await page.goto(base + '/search?q=' + 'x'.repeat(121));
  await expect(page.getByRole('status').filter({ hasText: 'Enter 2–120' })).toBeVisible();
  expect(state.requests.filter(r => r.pageSize === '5')).toHaveLength(count);
});


test('Same-page URL history replaces a pending inventory draft before its debounce fires', async ({ page }) => {
  const state = await setup(page); await page.goto(base + '/inventory?q=first');
  const input = page.getByRole('textbox', { name: 'Search inventory', exact: true });
  await expect(input).toHaveValue('first');
  await page.evaluate(() => {
    history.pushState({}, '', '/inventory?q=second');
    dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(input).toHaveValue('second');
  await input.fill('unapplied draft');
  await page.goBack(); await expect(input).toHaveValue('first');
  await page.waitForTimeout(450);
  expect(state.requests.some(r => r.search === 'unapplied draft')).toBe(false);
  await page.goForward(); await expect(input).toHaveValue('second');
});
