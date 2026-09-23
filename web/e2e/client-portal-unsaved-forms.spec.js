import { expect, test } from '@playwright/test';
const base = 'http://127.0.0.1:5177';
test.use({ contextOptions: { reducedMotion: 'reduce' } });

async function fixture(page) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const user = { id: 'draft-user', email: 'draft@example.test', aud: 'authenticated', role: 'authenticated',
    app_metadata: { role: 'admin', permissions: ['scope:global'] }, user_metadata: {} };
  const session = { access_token: [encode({ alg: 'HS256', typ: 'JWT' }), encode({ ...user, sub: user.id, exp: 4102444800 }), 'fixture'].join('.'),
    refresh_token: 'fixture', expires_at: 4102444800, expires_in: 2147483647, token_type: 'bearer', user };
  await page.addInitScript(s => localStorage.setItem('sb-portal-e2e-auth-token', JSON.stringify(s)), session);
  const order = { id: 101, orderNumber: 'DRAFT-101', clientId: 1, clientName: 'Draft client',
    orderDate: '2026-09-01', fulfillmentStatus: 'shipped', returnEligibility: { allowed: true, reason: null },
    orderedUnits: 2, items: [{ sku: 'DRAFT-SKU', name: 'Draft item', quantity: 2 }], chargeSummary: [], orderTotal: 10 };
  const state = { posts: [], fail: false, gate: null, errors: [], order, orderReads: 0 };
  page.on('pageerror', error => state.errors.push(error.message));
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    if (path.startsWith('/api/client-portal/')) {
      let body = { data: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 } };
      if (path.endsWith('/me')) body = { ...user, isAdmin: true, isGlobal: true, isRestricted: false, canViewFinancials: true, clientIds: [], storeIds: [] };
      if (path.endsWith('/clients')) body = { data: [{ id: 1, name: 'Draft client' }] };
      if (path.endsWith('/orders')) body = { data: [order], pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 } };
      if (/\/orders\/\d+$/.test(path)) { state.orderReads++; body = { data: { ...order, id: Number(path.split('/').at(-1)) } }; }
      if (req.method() === 'POST' && /\/(returns|inbound)$/.test(path)) {
        state.posts.push({ path, body: req.postDataJSON() });
        if (state.gate) await state.gate;
        if (state.fail) { await route.fulfill({ status: 400, json: { error: 'Fixture save rejected' } }); return; }
        body = { data: { id: 900 } };
      }
      if (/\/returns\/900$/.test(path)) body = { data: { id: 900, orderId: 101, status: 'requested', items: [], attachments: [], inspections: [] } };
      if (path.includes('/label')) { state.posts.push({ path }); body = { error: 'Fixture label unavailable' }; await route.fulfill({ status: 400, json: body }); return; }
      await route.fulfill({ json: body }); return;
    }
    if (url.origin === base) { await route.continue(); return; }
    await route.abort();
  });
  return state;
}
const confirmation = page => page.getByRole('dialog', { name: 'Discard unsaved changes?', exact: true });
const form = (page, kind) => page.getByRole('dialog', { name: kind === 'inbound' ? 'New inbound shipment' : 'Start a return', exact: true });
async function open(page, kind) {
  await page.goto(base + (kind === 'inbound' ? '/inbound' : '/returns?new=101'));
  if (kind === 'inbound') await page.getByRole('button', { name: 'New inbound', exact: true }).click();
  await expect(form(page, kind)).toBeVisible();
  if (kind === 'return') await expect(page.getByLabel('Return label recipient name')).toHaveValue('Draft client');
}
async function fill(page, kind) {
  const dialog = form(page, kind);
  if (kind === 'inbound') {
    await dialog.getByRole('combobox', { name: 'Client', exact: true }).selectOption('1');
    await dialog.getByPlaceholder('PO-1024').fill('MY-DRAFT');
    await dialog.getByPlaceholder('SKU', { exact: true }).fill('MY-SKU');
    await dialog.getByPlaceholder('Qty', { exact: true }).fill('2');
  } else {
    await dialog.getByLabel('Return quantity for Draft item').fill('1');
    await dialog.getByRole('textbox', { name: 'Reason', exact: true }).fill('MY-DRAFT');
    await dialog.getByLabel('Return label recipient name').fill('My recipient');
  }
}
async function retained(page, kind) {
  await expect(form(page, kind).getByRole('textbox', { name: kind === 'return' ? 'Reason' : 'Reference / PO #', exact: true })).toHaveValue('MY-DRAFT');
}
for (const kind of ['inbound', 'return']) {
  test(`${kind}: clean close, edited close paths, focus and discard`, async ({ page }) => {
    const state = await fixture(page); await open(page, kind);
    await form(page, kind).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(confirmation(page)).toHaveCount(0); await expect(form(page, kind)).toHaveCount(0);
    await open(page, kind); await fill(page, kind);
    for (const close of ['Cancel', 'Close', 'Escape', 'Backdrop']) {
      if (close === 'Escape') await page.keyboard.press('Escape');
      else if (close === 'Backdrop') await page.mouse.click(5, 5);
      else await form(page, kind).getByRole('button', { name: close, exact: true }).click();
      await expect(confirmation(page)).toBeVisible();
      await expect(confirmation(page).getByRole('button', { name: 'Keep editing' })).toBeFocused();
      await page.keyboard.press('Tab'); await expect(confirmation(page).getByRole('button', { name: 'Discard changes' })).toBeFocused();
      await page.keyboard.press('Tab'); await expect(confirmation(page).getByRole('button', { name: 'Close', exact: true })).toBeFocused();
      await confirmation(page).getByRole('button', { name: 'Keep editing' }).click(); await retained(page, kind);
    }
    await page.keyboard.press('Escape'); await confirmation(page).getByRole('button', { name: 'Discard changes' }).click();
    await expect(form(page, kind)).toHaveCount(0);
    await open(page, kind);
    await expect(form(page, kind).getByRole('textbox', { name: kind === 'return' ? 'Reason' : 'Reference / PO #', exact: true })).toHaveValue('');
    expect(state.posts).toEqual([]); expect(state.errors).toEqual([]);
  });

  test(`${kind}: failed save retains draft, pending save cannot dismiss, success clears guard`, async ({ page }) => {
    const state = await fixture(page); state.fail = true; await open(page, kind); await fill(page, kind);
    const saveName = kind === 'return' ? 'Start return only' : 'Create inbound';
    await form(page, kind).getByRole('button', { name: saveName, exact: true }).click();
    await expect(page.getByText('Fixture save rejected')).toBeVisible(); await retained(page, kind);
    state.fail = false; let release; state.gate = new Promise(resolve => { release = resolve; });
    await form(page, kind).getByRole('button', { name: saveName, exact: true }).click();
    await expect.poll(() => state.posts.length).toBe(2);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('status').filter({ hasText: 'Saving. Please wait' })).toBeVisible();
    await expect(confirmation(page)).toHaveCount(0);
    await expect(form(page, kind).getByRole('textbox', { name: kind === 'return' ? 'Reason' : 'Reference / PO #', exact: true })).toBeDisabled();
    release(); await expect(form(page, kind)).toHaveCount(0); await expect(confirmation(page)).toHaveCount(0);
    const { idempotencyKey: firstKey, ...firstDraft } = state.posts[0].body;
    const { idempotencyKey: retryKey, ...retriedDraft } = state.posts[1].body;
    expect(firstDraft).toEqual(retriedDraft);
    if (kind === 'inbound') expect(retryKey).not.toBe(firstKey); // the fixture rejected the first intent with 400 before saving
    expect(state.posts.filter(post => post.path.includes('/label'))).toHaveLength(0);
    let warned = false; page.on('dialog', async dialog => { warned = true; await dialog.dismiss(); });
    await page.reload(); expect(warned).toBe(false); expect(state.errors).toEqual([]);
  });

  test(`${kind}: browser refresh warns and cancelling keeps values`, async ({ page }) => {
    await fixture(page); await open(page, kind); await fill(page, kind);
    const warning = page.waitForEvent('dialog');
    await page.evaluate(() => { setTimeout(() => location.reload(), 0); });
    const dialog = await warning; expect(dialog.type()).toBe('beforeunload'); await dialog.dismiss();
    await retained(page, kind);
    const leaving = page.waitForEvent('dialog');
    const navigated = page.waitForEvent('framenavigated', frame => frame === page.mainFrame());
    await page.evaluate(() => { setTimeout(() => location.reload(), 0); });
    await (await leaving).accept(); await navigated;
    if (kind === 'inbound') await page.getByRole('button', { name: 'New inbound', exact: true }).click();
    await expect(form(page, kind).getByRole('textbox', { name: kind === 'return' ? 'Reason' : 'Reference / PO #', exact: true })).toHaveValue('');
  });

  test(`${kind}: phone confirmation fits and keeps input`, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 }); await fixture(page); await open(page, kind); await fill(page, kind);
    await page.keyboard.press('Escape'); await expect(confirmation(page)).toBeVisible();
    const bounds = await confirmation(page).boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: info.outputPath(`${kind}-discard-mobile.png`) });
    await confirmation(page).getByRole('button', { name: 'Keep editing' }).click(); await retained(page, kind);
  });
}

test('browser Back protects inbound draft; discard completes navigation and Forward starts clean', async ({ page }) => {
  const state = await fixture(page); await page.goto(base + '/orders');
  await page.getByRole('link', { name: 'Inbound', exact: true }).click();
  await page.getByRole('button', { name: 'New inbound', exact: true }).click(); await fill(page, 'inbound');
  await page.goBack(); await expect(confirmation(page)).toBeVisible();
  await confirmation(page).getByRole('button', { name: 'Keep editing' }).click(); await retained(page, 'inbound'); await expect(page).toHaveURL(/\/inbound$/);
  await page.goBack(); await confirmation(page).getByRole('button', { name: 'Discard changes' }).click();
  await expect(page).toHaveURL(/\/orders$/); await expect(confirmation(page)).toHaveCount(0);
  await page.goForward(); await page.getByRole('button', { name: 'New inbound', exact: true }).click();
  await expect(page.getByPlaceholder('PO-1024')).toHaveValue(''); expect(state.errors).toEqual([]);
});

test('Escape protects return inside order drawer and restores focus after Keep editing', async ({ page }) => {
  const state = await fixture(page); await page.goto(base + '/orders');
  await page.getByRole('row').filter({ hasText: 'DRAFT-101' }).click();
  const drawer = page.getByRole('dialog'); await drawer.getByRole('button', { name: 'Start a return', exact: true }).click();
  await fill(page, 'return'); await page.getByRole('textbox', { name: 'Reason', exact: true }).focus();
  await page.keyboard.press('Escape'); await expect(confirmation(page)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(2);
  await confirmation(page).getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByRole('textbox', { name: 'Reason', exact: true })).toBeFocused(); await retained(page, 'return');
  await page.keyboard.press('Escape'); await confirmation(page).getByRole('button', { name: 'Discard changes' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  await expect(page.getByRole('button', { name: 'Start a return', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden'); expect(state.errors).toEqual([]);
});

test('created return with failed label closes draft without offering duplicate creation', async ({ page }) => {
  const state = await fixture(page); await open(page, 'return'); await fill(page, 'return');
  await form(page, 'return').getByRole('button', { name: 'Save & create return label', exact: true }).click();
  await expect(page.getByText('Return created - label needs attention', { exact: true })).toBeVisible();
  await expect(form(page, 'return')).toHaveCount(0); await expect(confirmation(page)).toHaveCount(0);
  expect(state.posts).toHaveLength(2); expect(state.posts[0].path).toBe('/api/client-portal/returns');
  expect(state.posts[1].path).toContain('/900/label'); expect(state.errors).toEqual([]);
});


test('background order refresh preserves entered return reason, quantities and recipient', async ({ page }) => {
  const state = await fixture(page); await open(page, 'return'); await fill(page, 'return');
  const reads = state.orderReads; state.order.clientName = 'Updated backend client';
  await page.clock.install(); await page.clock.fastForward(301_000);
  // Reconnection refetches the now-stale query, just as a real offline tab reconnecting would.
  await page.evaluate(() => { window.dispatchEvent(new Event('offline')); window.dispatchEvent(new Event('online')); });
  await expect.poll(() => state.orderReads).toBeGreaterThan(reads);
  await expect(form(page, 'return').getByText('DRAFT-101 · Updated backend client', { exact: true })).toBeVisible();
  await retained(page, 'return');
  await expect(page.getByLabel('Return quantity for Draft item')).toHaveValue('1');
  await expect(page.getByLabel('Return label recipient name')).toHaveValue('My recipient');
  expect(state.errors).toEqual([]); expect(state.posts).toEqual([]);
});

test('return draft blocks in-app links and a different order starts clean after discard', async ({ page }) => {
  const state = await fixture(page); await open(page, 'return'); await fill(page, 'return');
  // Dispatch the existing router link while a modal is open (e.g. a keyboard shortcut).
  await page.getByRole('link', { name: 'Orders', exact: true }).dispatchEvent('click');
  await expect(confirmation(page)).toBeVisible();
  await confirmation(page).getByRole('button', { name: 'Keep editing' }).click(); await retained(page, 'return');
  await page.getByRole('link', { name: 'Orders', exact: true }).dispatchEvent('click');
  await confirmation(page).getByRole('button', { name: 'Discard changes' }).click(); await expect(page).toHaveURL(/\/orders$/);
  await page.goto(base + '/returns?new=202');
  await expect(page.getByLabel('Return label recipient name')).toHaveValue('Draft client');
  await expect(page.getByRole('textbox', { name: 'Reason', exact: true })).toHaveValue('');
  await expect(page.getByLabel('Return quantity for Draft item')).toHaveValue(''); expect(state.errors).toEqual([]);
});
