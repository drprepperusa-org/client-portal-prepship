import { expect, test } from '@playwright/test';
const base = 'http://127.0.0.1:5177';
test.use({ contextOptions: { reducedMotion: 'reduce' } });
async function fixture(page) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const user = { id: 'inbound-user', email: 'inbound@example.test', aud: 'authenticated', role: 'authenticated',
    app_metadata: { role: 'admin', permissions: ['scope:global'] }, user_metadata: {} };
  const session = { access_token: [encode({ alg: 'HS256', typ: 'JWT' }), encode({ ...user, sub: user.id, exp: 4102444800 }), 'fixture'].join('.'),
    refresh_token: 'fixture', expires_at: 4102444800, expires_in: 2147483647, token_type: 'bearer', user };
  await page.addInitScript(s => localStorage.setItem('sb-portal-e2e-auth-token', JSON.stringify(s)), session);
  const state = { posts: [], saved: new Map(), mode: 'success', errors: [], failList: false };
  page.on('pageerror', error => state.errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (!path.startsWith('/api/client-portal/')) {
      if (url.origin === base) await route.continue(); else await route.abort();
      return;
    }
    let body = { data: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 } };
    if (path.endsWith('/me')) body = { ...user, isAdmin: true, isGlobal: true, isRestricted: false, clientIds: [], storeIds: [] };
    if (path.endsWith('/clients')) body = { data: [{ id: 1, name: 'Inbound client' }, { id: 2, name: 'Other client' }] };
    if (path.endsWith('/inbound') && request.method() === 'GET' && state.failList) {
      await route.fulfill({ status: 500, json: { error: 'Fixture list unavailable' } }); return;
    }
    if (path.endsWith('/inbound') && request.method() === 'POST') {
      const input = request.postDataJSON(); state.posts.push(input);
      if (state.mode === 'reject') {
        await route.fulfill({ status: 400, json: { error: 'Correct the quantity.', fieldErrors: { 'items.0.expectedQty': 'Enter 1 for this fixture.' } } }); return;
      }
      const replayed = state.saved.has(input.idempotencyKey);
      if (!replayed) state.saved.set(input.idempotencyKey, { id: 900 + state.saved.size, reference: 'SERVER-PO', clientId: 1, clientName: 'Inbound client',
        status: 'expected', supplier: null, carrier: null, trackingNumber: null, expectedDate: null, receivedDate: null, notes: null,
        createdAt: '2026-09-23T00:00:00Z', expectedUnits: 2, receivedUnits: 0,
        items: [{ id: 500, sku: 'MY-SKU', name: 'Saved item', expectedQty: 2, receivedQty: 0 }] });
      if (state.mode === 'lost') { state.mode = 'success'; await route.abort(); return; }
      body = { data: state.saved.get(input.idempotencyKey), replayed };
    }
    await route.fulfill({ json: body });
  });
  await page.goto(base + '/inbound');
  await page.getByRole('button', { name: 'New inbound', exact: true }).click();
  await page.getByPlaceholder('PO-1024').fill('Draft reference');
  await page.getByLabel('SKU for item 1', { exact: true }).fill('MY-SKU');
  await page.getByLabel('Expected quantity for item 1', { exact: true }).fill('2');
  return state;
}
test('Lost save response retries the original request and opens the one saved shipment', async ({ page }) => {
  const state = await fixture(page); state.mode = 'lost';
  await page.getByRole('button', { name: 'Create inbound', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry save', exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('PO-1024')).toBeDisabled();
  await expect(page.getByPlaceholder('PO-1024')).toHaveValue('Draft reference');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText(/This shipment may already be saved/)).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  state.mode = 'reject';
  await page.getByRole('button', { name: 'Retry save', exact: true }).click();
  await expect(page.getByText('Correct the quantity.', { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder('PO-1024')).toBeDisabled(); // a later rejection cannot erase an earlier uncertain commit
  state.mode = 'success';
  await page.getByRole('button', { name: 'Retry save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open shipment', exact: true })).toBeVisible();
  expect(state.posts).toHaveLength(3); expect(state.posts[1]).toEqual(state.posts[0]); expect(state.posts[2]).toEqual(state.posts[0]); expect(state.saved.size).toBe(1);
  await page.getByRole('button', { name: 'Open shipment', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'SERVER-PO', exact: true });
  await expect(drawer).toBeVisible(); await expect(drawer.getByText('Saved item · MY-SKU')).toBeVisible();
  expect(state.errors).toEqual([]);
});
test('Definitive validation failure allows editing and a new valid save intent', async ({ page }) => {
  const state = await fixture(page); state.mode = 'reject';
  await page.getByRole('button', { name: 'Create inbound', exact: true }).click();
  const qty = page.getByLabel('Expected quantity for item 1', { exact: true });
  await expect(qty).toBeFocused(); await expect(qty).toBeEnabled(); expect(state.saved.size).toBe(0);
  await qty.fill('1'); state.mode = 'success';
  await page.getByRole('button', { name: 'Create inbound', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open shipment', exact: true })).toBeVisible();
  expect(state.posts[1].idempotencyKey).not.toBe(state.posts[0].idempotencyKey); expect(state.saved.size).toBe(1);
});
test('Saved confirmation survives failed list refresh, fits mobile, and clears on scope change', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); const state = await fixture(page); state.failList = true;
  await page.getByRole('button', { name: 'Create inbound', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open shipment', exact: true })).toBeVisible();
  expect(state.posts).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('inbound-saved-mobile.png'), fullPage: true });
  await page.getByRole('combobox', { name: 'Filter by client', exact: true }).selectOption('2');
  await expect(page.getByRole('button', { name: 'Open shipment', exact: true })).toHaveCount(0);
  expect(state.errors).toEqual([]);
});
