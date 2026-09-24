import { expect, test } from '@playwright/test';
const base = 'http://127.0.0.1:5177';
test.use({ contextOptions: { reducedMotion: 'reduce' } });
async function fixture(page) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const user = { id: 'receive-user', email: 'receive@example.test', aud: 'authenticated', role: 'authenticated',
    app_metadata: { role: 'admin', permissions: ['scope:global'] }, user_metadata: {} };
  const session = { access_token: [encode({ alg: 'HS256', typ: 'JWT' }), encode({ ...user, sub: user.id, exp: 4102444800 }), 'fixture'].join('.'),
    refresh_token: 'fixture', expires_at: 4102444800, expires_in: 2147483647, token_type: 'bearer', user };
  await page.addInitScript(s => localStorage.setItem('sb-portal-e2e-auth-token', JSON.stringify(s)), session);
  const state = { writes: [], mode: 'success', received: false, failRead: false, receiptReads: 0, errors: [], release: null, previews: [], previewMode: 'success' };
  page.on('pageerror', error => state.errors.push(error.message));
  const shipment = { id: 901, reference: 'PO-RECEIVE', clientId: 1, clientName: 'Receiving client', status: 'expected',
    supplier: 'Supplier', carrier: null, trackingNumber: null, expectedDate: null, receivedDate: null, notes: null,
    createdAt: '2026-09-23T00:00:00Z', expectedUnits: 7, receivedUnits: 0,
    items: [{ id: 11, sku: 'SKU-A', name: 'First item', expectedQty: 5, receivedQty: 0 },
      { id: 12, sku: 'SKU-B', name: 'Second item', expectedQty: 2, receivedQty: 0 }] };
  await page.route('**/*', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (!path.startsWith('/api/client-portal/')) { if (url.origin === base) await route.continue(); else await route.abort(); return; }
    let body = { data: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 } };
    if (path.endsWith('/me')) body = { ...user, isAdmin: true, isGlobal: true, canReceiveInventory: true, clientIds: [], storeIds: [] };
    if (path.endsWith('/clients')) body = { data: [{ id: 1, name: 'Receiving client' }] };
    if (path.endsWith('/inbound')) body = { data: [{ ...shipment, status: state.received ? 'received' : 'expected' }],
      pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 } };
    if (path.endsWith('/inbound/receipts')) {
      state.receiptReads++;
      if (state.received) body = { data: [{ id: 123, inventoryId: 21, clientId: 1, clientName: 'Receiving client', sku: 'SKU-A', name: 'First item',
        receivedUnits: 3, receivedAt: '2026-09-23T00:00:00Z', note: 'Inbound PO-RECEIVE' }], pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 } };
    }
    if (path.endsWith('/receive/preview')) {
      const input = route.request().postDataJSON(); state.previews.push(input);
      if (state.previewMode === 'error') { await route.fulfill({ status: 503, json: { error: 'Fixture preview unavailable' } }); return; }
      const rows = shipment.items.map((item, index) => {
        const receivedQty = input.items.find(row => row.id === item.id).receivedQty;
        const difference = receivedQty - item.expectedQty;
        const missing = state.previewMode === 'blocked' && index === 1;
        return { ...item, receivedQty, difference, quantityStatus: difference < 0 ? 'short' : difference > 0 ? 'extra' : 'exact',
          inventoryMatch: missing ? 'missing' : 'matched', inventoryUnits: input.addToInventory && !missing ? receivedQty : 0,
          issue: input.addToInventory && missing && receivedQty > 0 ? 'No unique inventory match. Correct the SKU.' : null };
      });
      const canConfirm = rows.every(row => !row.issue);
      body = { data: { reference: shipment.reference, addToInventory: input.addToInventory, rows, expectedUnits: 7,
        receivedUnits: rows.reduce((sum, row) => sum + row.receivedQty, 0), inventoryUnits: rows.reduce((sum, row) => sum + row.inventoryUnits, 0),
        issues: [], canConfirm, fingerprint: canConfirm ? 'a'.repeat(64) : null } };
    }
    if (path.endsWith('/receive')) {
      expect(route.request().method()).toBe('PATCH'); state.writes.push(route.request().postDataJSON());
      if (state.mode === 'held') await new Promise(resolve => { state.release = resolve; });
      if (state.mode === 'error') { await route.fulfill({ status: 503, json: { error: 'Fixture unavailable' } }); return; }
      if (state.mode === 'stale') { await route.fulfill({ status: 409, json: { error: 'The receiving preview has changed. Preview again.' } }); return; }
      if (state.mode === 'reject') {
        await route.fulfill({ status: 400, json: { error: 'Check received quantity.', fieldErrors: { 'items.1.receivedQty': 'Use a whole number.' } } }); return;
      }
      state.received = true; body = { data: { id: 901, status: 'received', bumps: [{ sku: 'SKU-A', qty: 3, matched: true }] } };
    } else if (state.received && state.failRead && (path.endsWith('/inbound') || path.endsWith('/inbound/receipts'))) {
      await route.fulfill({ status: 503, json: { error: 'Fixture refresh failed' } }); return;
    }
    await route.fulfill({ json: body });
  });
  await page.goto(base + '/inventory');
  await page.getByRole('link', { name: 'Inbound', exact: true }).click();
  await page.getByRole('button', { name: 'View inbound PO-RECEIVE', exact: true }).click();
  await page.getByRole('button', { name: 'Receive shipment', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Receive shipment', exact: true });
  await expect(modal).toBeVisible();
  return { state, modal, qty: modal.getByLabel('Received quantity for item 1', { exact: true }) };
}
async function checkPreview(modal) {
  await modal.getByRole('button', { name: 'Preview receipt', exact: true }).click();
  await expect(modal.getByRole('region', { name: 'Receiving preview', exact: true })).toBeVisible();
}
async function confirm(modal) {
  await checkPreview(modal);
  await modal.getByRole('button', { name: 'Confirm receive', exact: true }).click();
}

test('Invalid and blank receiving quantities are inline; explicit zero saves and refreshes receipts', async ({ page }) => {
  const { state, modal, qty } = await fixture(page);
  for (const value of ['', '-1', '1.5', '2147483648']) {
    await qty.fill(value); await modal.getByRole('button', { name: 'Preview receipt', exact: true }).click();
    await expect(qty).toHaveAttribute('aria-invalid', 'true'); await expect(qty).toBeFocused(); expect(state.writes).toHaveLength(0);
  }
  await qty.fill('0');
  const priorReads = state.receiptReads;
  await confirm(modal);
  await expect(page.getByText('Shipment received', { exact: true })).toBeVisible();
  await expect(modal).toHaveCount(0);
  expect(state.writes[0]).toEqual({ previewFingerprint: 'a'.repeat(64), addToInventory: true, items: [{ id: 11, receivedQty: 0 }, { id: 12, receivedQty: 2 }] });
  await expect.poll(() => state.receiptReads).toBeGreaterThan(priorReads);
  await expect(page.getByText('Inbound PO-RECEIVE', { exact: true }).filter({ visible: true })).toBeVisible();
  expect(state.errors).toEqual([]);
});
test('Dirty cancel, Escape and browser Back preserve values until discard', async ({ page }) => {
  const { modal, qty } = await fixture(page); await qty.fill('3');
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click(); await expect(qty).toHaveValue('3');
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click(); await expect(qty).toHaveValue('3');
  await page.goBack(); await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click(); await expect(qty).toHaveValue('3');
  await page.goBack(); await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page).toHaveURL(/\/inventory$/);
});
test('Failed save preserves quantities and maps server field errors; pending save cannot dismiss or repeat', async ({ page }) => {
  const { state, modal, qty } = await fixture(page); await qty.fill('3'); state.mode = 'error';
  await confirm(modal);
  await expect(modal.getByRole('alert')).toContainText('Your entries are still here'); await expect(qty).toHaveValue('3');
  state.mode = 'reject'; await confirm(modal);
  await expect(modal.getByLabel('Received quantity for item 2', { exact: true })).toBeFocused(); await expect(qty).toHaveValue('3');
  state.mode = 'held'; await confirm(modal);
  await expect.poll(() => Boolean(state.release)).toBe(true); await expect(qty).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(modal).toBeVisible();
  await expect(modal.getByText('Saving. Please wait before leaving this form.')).toBeVisible();
  expect(state.writes).toHaveLength(3); state.failRead = true; state.release();
  await expect(page.getByText('Shipment received', { exact: true })).toBeVisible(); await expect(modal).toHaveCount(0);
  expect(state.writes).toHaveLength(3); expect(state.errors).toEqual([]);
});
test('Incomplete numeric text does not save as zero; mobile draft confirmation fits', async ({ page }, info) => {
  const { state, modal, qty } = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await qty.fill(''); await qty.pressSequentially('e');
  await modal.getByRole('button', { name: 'Preview receipt', exact: true }).click();
  await expect(qty).toHaveAttribute('aria-invalid', 'true'); expect(state.writes).toHaveLength(0);
  await qty.fill('3');
  await page.screenshot({ path: info.outputPath('receive-form-mobile.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('receive-discard-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click(); await expect(qty).toHaveValue('3');
});

test('Clean close is immediate; checkbox edits and browser refresh protect the draft', async ({ page }) => {
  const { modal, qty } = await fixture(page);
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(modal).toHaveCount(0);
  await page.getByRole('button', { name: 'Receive shipment', exact: true }).click();
  await modal.getByRole('checkbox').uncheck();
  await modal.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(modal.getByRole('checkbox')).not.toBeChecked(); await qty.fill('3');
  const warning = page.waitForEvent('dialog');
  await page.evaluate(() => { setTimeout(() => location.reload(), 0); });
  const dialog = await warning; expect(dialog.type()).toBe('beforeunload'); await dialog.dismiss();
  await expect(qty).toHaveValue('3');
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await page.getByRole('button', { name: 'Receive shipment', exact: true }).click();
  await expect(qty).toHaveValue('5'); await expect(modal.getByRole('checkbox')).toBeChecked();
});


test('Preview shows shortages, extras and planned additions; editing requires a new preview', async ({ page }, info) => {
  const { state, modal, qty } = await fixture(page);
  await expect(modal.getByRole('button', { name: 'Confirm receive', exact: true })).toHaveCount(0);
  await qty.fill('3'); await modal.getByLabel('Received quantity for item 2', { exact: true }).fill('4');
  await checkPreview(modal);
  const review = modal.getByRole('region', { name: 'Receiving preview', exact: true });
  await expect(review.getByText('-2 · Shortage', { exact: true })).toBeVisible();
  await expect(review.getByText('+2 · Extra units', { exact: true })).toBeVisible();
  await expect(review.getByText('Matched', { exact: true })).toHaveCount(2); expect(state.writes).toHaveLength(0);
  await page.setViewportSize({ width: 390, height: 844 }); await review.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('receiving-preview-mobile.png'), fullPage: true });
  await qty.fill('2'); await expect(review).toHaveCount(0);
  await expect(modal.getByRole('button', { name: 'Confirm receive', exact: true })).toHaveCount(0);
  await checkPreview(modal); await modal.getByRole('checkbox').uncheck(); await expect(review).toHaveCount(0);
  await checkPreview(modal); await expect(review.getByText('This receipt will not add any units to inventory.')).toBeVisible();
  await modal.getByRole('button', { name: 'Confirm receive', exact: true }).click();
  expect(state.writes[0].addToInventory).toBe(false); expect(state.writes[0].items[0].receivedQty).toBe(2);
});

test('Missing inventory matches block confirmation until corrected or inventory additions are disabled', async ({ page }) => {
  const { state, modal } = await fixture(page); state.previewMode = 'blocked'; await checkPreview(modal);
  await expect(modal.getByText('SKU not found', { exact: true })).toBeVisible();
  await expect(modal.getByText('No unique inventory match. Correct the SKU.')).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Confirm receive', exact: true })).toHaveCount(0); expect(state.writes).toHaveLength(0);
  await modal.getByRole('checkbox').uncheck(); await checkPreview(modal);
  await expect(modal.getByRole('button', { name: 'Confirm receive', exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(0);
});

test('Preview failure and stale confirmation preserve input and require another review', async ({ page }) => {
  const { state, modal, qty } = await fixture(page); await qty.fill('3'); state.previewMode = 'error';
  await modal.getByRole('button', { name: 'Preview receipt', exact: true }).click();
  await expect(modal.getByRole('alert')).toContainText('Your entries are still here'); await expect(qty).toHaveValue('3');
  await expect(modal.getByRole('button', { name: 'Confirm receive', exact: true })).toHaveCount(0);
  state.previewMode = 'success'; state.mode = 'stale'; await confirm(modal);
  await expect(modal.getByRole('alert')).toContainText('preview has changed'); await expect(qty).toHaveValue('3');
  await expect(modal.getByRole('region', { name: 'Receiving preview', exact: true })).toHaveCount(0);
  state.mode = 'success'; await confirm(modal); await expect(modal).toHaveCount(0); expect(state.writes).toHaveLength(2);
});
