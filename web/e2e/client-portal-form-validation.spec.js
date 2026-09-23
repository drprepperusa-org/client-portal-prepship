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
  const state = { posts: [], fail: false, gate: null, errors: [], order, orderReads: 0, failureBody: null };
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
        if (state.fail) { await route.fulfill({ status: 400, json: state.failureBody ?? { error: 'Fixture save rejected' } }); return; }
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
test('Return highlights required fields and focuses each problem before any request', async ({ page }) => {
  const state = await fixture(page); await open(page, 'return');
  const dialog = form(page, 'return'), save = dialog.getByRole('button', { name: 'Start return only', exact: true });
  const qty = dialog.getByLabel('Return quantity for Draft item');
  const reason = dialog.getByRole('textbox', { name: 'Reason', exact: true });
  await save.click(); await expect(qty).toBeFocused(); await expect(reason).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.getByText('At least one returned item with a positive quantity is required', { exact: true })).toBeVisible();
  expect(state.posts).toHaveLength(0);
  await qty.fill('1'); await save.click(); await expect(reason).toBeFocused();
  await reason.fill('Wrong item'); await dialog.getByLabel('Return label recipient name').fill('');
  await save.click(); await expect(dialog.getByLabel('Return label recipient name')).toBeFocused();
  await expect(dialog.getByText('Return recipient name is required', { exact: true })).toBeVisible();
  expect(state.posts).toHaveLength(0);
  await dialog.getByLabel('Return label recipient name').fill('Confirmed recipient'); await save.click();
  await expect(dialog).toHaveCount(0); expect(state.posts).toHaveLength(1);
  expect(state.posts[0].body).toMatchObject({ reason: 'Wrong item', returnRecipientName: 'Confirmed recipient', items: [{ sku: 'DRAFT-SKU', quantity: 1 }] });
  expect(state.errors).toEqual([]);
});

test('Return rejects an excessive quantity inline and accepts existing fractional quantities', async ({ page }) => {
  const state = await fixture(page); await open(page, 'return'); await fill(page, 'return');
  const qty = page.getByLabel('Return quantity for Draft item');
  await qty.fill('3'); await page.getByRole('button', { name: 'Start return only', exact: true }).click();
  await expect(qty).toBeFocused(); await expect(qty).toHaveAttribute('aria-invalid', 'true');
  await expect(qty).toHaveAccessibleDescription('Enter no more than the ordered quantity (2).'); expect(state.posts).toHaveLength(0);
  await qty.fill('1.5'); await expect(qty).not.toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Start return only', exact: true }).click();
  await expect(form(page, 'return')).toHaveCount(0); expect(state.posts[0].body.items[0].quantity).toBe(1.5);
});

test('Inbound validates quantities and unfinished rows without requiring optional headers', async ({ page }) => {
  const state = await fixture(page); await open(page, 'inbound');
  const qty = page.getByRole('spinbutton', { name: 'Expected quantity for item 1' });
  await page.getByPlaceholder('SKU', { exact: true }).fill('TEST'); await qty.fill('1.5'); await qty.press('Tab');
  await expect(qty).toHaveAttribute('aria-invalid', 'true');
  await page.getByRole('button', { name: 'Create inbound', exact: true }).click(); await expect(qty).toBeFocused();
  await expect(qty).toHaveAccessibleDescription('Enter a whole number from 0 to 2,147,483,647.'); expect(state.posts).toHaveLength(0);
  await qty.fill('2'); await page.getByPlaceholder('SKU', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Create inbound', exact: true }).click();
  await expect(page.getByPlaceholder('SKU', { exact: true })).toBeFocused();
  await expect(page.getByText('Enter a SKU or item name for this quantity.')).toBeVisible();
  await page.getByPlaceholder('Item name').fill('Name only'); await qty.fill('0');
  await page.getByRole('button', { name: 'Create inbound', exact: true }).click(); await expect(form(page, 'inbound')).toHaveCount(0);
  expect(state.posts).toHaveLength(1); expect(state.posts[0].body.items).toEqual([{ name: 'Name only', expectedQty: 0 }]);
  expect(state.posts[0].body.clientId).toBeUndefined(); expect(state.errors).toEqual([]);
});

test('Return validates selected lines on a large order and maps local errors to the displayed row', async ({ page }) => {
  const state = await fixture(page);
  state.order.items = Array.from({ length: 205 }, (_, index) => ({ sku: `SKU-${index}`, name: `Item ${index}`, quantity: 2 }));
  state.order.items[204].sku = '';
  await open(page, 'return');
  const qty = page.getByLabel('Return quantity for Item 204', { exact: true });
  await qty.fill('1'); await page.getByRole('textbox', { name: 'Reason', exact: true }).fill('Wrong item');
  await page.getByRole('button', { name: 'Start return only', exact: true }).click();
  await expect(qty).toBeFocused();
  await expect(qty).toHaveAccessibleDescription('This item needs a SKU or item name before it can be returned.');
  expect(state.posts).toHaveLength(0);
  await qty.fill(''); await page.getByLabel('Return quantity for Item 203', { exact: true }).fill('1');
  await page.getByRole('button', { name: 'Start return only', exact: true }).click();
  await expect(form(page, 'return')).toHaveCount(0);
  expect(state.posts).toHaveLength(1); expect(state.posts[0].body.items).toMatchObject([{ sku: 'SKU-203', quantity: 1 }]);
});

for (const kind of ['return', 'inbound']) {
  test(`${kind}: unfinished numeric text is not converted to blank or zero`, async ({ page }) => {
    const state = await fixture(page); await open(page, kind); await fill(page, kind);
    const qty = form(page, kind).getByRole('spinbutton').first(); await qty.fill(''); await qty.pressSequentially('e');
    expect(await qty.evaluate(input => input.validity.badInput)).toBe(true);
    await form(page, kind).getByRole('button', { name: kind === 'return' ? 'Start return only' : 'Create inbound', exact: true }).click();
    await expect(qty).toBeFocused(); await expect(qty).toHaveAccessibleDescription('Enter a valid number.'); expect(state.posts).toHaveLength(0);
  });

  test(`${kind}: server field errors focus the submitted row and preserve all draft values`, async ({ page }) => {
    const state = await fixture(page); state.fail = true;
    if (kind === 'return') state.order.items.push({ sku: 'SECOND-SKU', name: 'Second item', quantity: 4 });
    await open(page, kind);
    if (kind === 'return') {
      await page.getByLabel('Return quantity for Second item').fill('2');
      await page.getByRole('textbox', { name: 'Reason', exact: true }).fill('MY-DRAFT');
    } else {
      await page.getByRole('button', { name: 'Add item', exact: true }).click();
      await page.getByLabel('SKU for item 2', { exact: true }).fill('SECOND-SKU');
      await page.getByLabel('Expected quantity for item 2', { exact: true }).fill('2');
      await page.getByPlaceholder('PO-1024').fill('MY-DRAFT');
    }
    const quantityField = kind === 'return' ? 'quantity' : 'expectedQty';
    state.failureBody = { error: 'Review this item quantity.', fieldErrors: { [`items.0.${quantityField}`]: 'Quantity changed on the server. Enter 1.' } };
    await page.getByRole('button', { name: kind === 'return' ? 'Start return only' : 'Create inbound', exact: true }).click();
    const qty = page.getByRole('spinbutton').nth(1); await expect(qty).toBeFocused();
    await expect(qty).toHaveAccessibleDescription('Quantity changed on the server. Enter 1.'); await retained(page, kind);
    expect(state.posts[0].body.items).toHaveLength(1); expect(state.posts[0].body.items[0].sku).toBe('SECOND-SKU');
    state.fail = false; await qty.fill('1'); await expect(qty).not.toHaveAttribute('aria-invalid', 'true');
    await page.getByRole('button', { name: kind === 'return' ? 'Start return only' : 'Create inbound', exact: true }).click();
    await expect(form(page, kind)).toHaveCount(0); expect(state.posts).toHaveLength(2); expect(state.errors).toEqual([]);
  });

  test(`${kind}: mobile errors fit and keep the first invalid control reachable`, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 }); const state = await fixture(page); await open(page, kind);
    if (kind === 'inbound') await page.getByRole('spinbutton').fill('-1');
    await page.getByRole('button', { name: kind === 'return' ? 'Start return only' : 'Create inbound', exact: true }).click();
    await expect(form(page, kind).getByRole('alert')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`${kind}-validation-mobile.png`) });
    expect(state.posts).toHaveLength(0); expect(state.errors).toEqual([]);
  });
}
