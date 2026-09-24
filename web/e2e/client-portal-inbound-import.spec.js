import { expect, test } from '@playwright/test';
import { parseInboundImport } from '../../src/lib/client-portal/inbound-import-csv';
const base = 'http://127.0.0.1:5177';
const csv = 'client,reference,sku,name,qty\nAlpha,PO-ONE,SKU-A,First item,3\nAlpha,PO-TWO,SKU-B,Second item,0';
test.use({ contextOptions: { reducedMotion: 'reduce' } });
async function fixture(page) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const user = { id: 'import-user', email: 'import@example.test', aud: 'authenticated', role: 'authenticated',
    app_metadata: { role: 'admin', permissions: ['scope:global'] }, user_metadata: {} };
  const session = { access_token: [encode({ alg: 'HS256', typ: 'JWT' }), encode({ ...user, sub: user.id, exp: 4102444800 }), 'fixture'].join('.'),
    refresh_token: 'fixture', expires_at: 4102444800, expires_in: 2147483647, token_type: 'bearer', user };
  await page.addInitScript(s => localStorage.setItem('sb-portal-e2e-auth-token', JSON.stringify(s)), session);
  const state = { previews: [], writes: [], saved: new Map(), mode: 'success', previewFail: false, failRead: false, reads: 0, errors: [], release: null };
  page.on('pageerror', error => state.errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (!path.startsWith('/api/client-portal/')) { if (url.origin === base) await route.continue(); else await route.abort(); return; }
    let body = { data: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 } };
    if (path.endsWith('/me')) body = { ...user, isAdmin: true, isGlobal: true, clientIds: [], storeIds: [] };
    if (path.endsWith('/clients')) body = { data: [{ id: 1, name: 'Alpha' }] };
    if (path.endsWith('/inbound')) {
      state.reads++;
      if (state.failRead) { await route.fulfill({ status: 503, json: { error: 'Fixture list failed' } }); return; }
    }
    if (path.endsWith('/inbound/import/preview')) {
      state.previews.push(route.request().postDataJSON());
      if (state.previewFail) { await route.fulfill({ status: 503, json: { error: 'Fixture preview failed' } }); return; }
      body = { data: parseInboundImport(route.request().postDataJSON().csv, [{ id: 1, name: 'Alpha' }]).preview };
    }
    if (path.endsWith('/inbound/import')) {
      const input = route.request().postDataJSON(); state.writes.push(input);
      if (state.mode === 'reject') { await route.fulfill({ status: 400, json: { error: 'Preview the CSV again.' } }); return; }
      if (state.mode === 'held') await new Promise(resolve => { state.release = resolve; });
      const replayed = state.saved.has(input.idempotencyKey);
      if (!replayed) state.saved.set(input.idempotencyKey, { created: 2, itemsCreated: 2, skipped: 0 });
      if (state.mode === 'lost') { state.mode = 'success'; await route.abort(); return; }
      body = { data: { ...state.saved.get(input.idempotencyKey), replayed } };
    }
    await route.fulfill({ json: body });
  });
  await page.goto(base + '/inventory');
  await page.getByRole('link', { name: 'Inbound', exact: true }).click();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Import inbound CSV', exact: true });
  return { state, modal, input: modal.getByLabel('CSV data', { exact: true }) };
}
async function preview(modal, input, text = csv) {
  await input.fill(text); await modal.getByRole('button', { name: 'Preview import', exact: true }).click();
  await expect(modal.getByRole('region', { name: 'Import preview', exact: true })).toBeVisible();
}
test('Preview highlights row errors, requires rechecking edits, and saves the exact reviewed CSV', async ({ page }) => {
  const { state, modal, input } = await fixture(page);
  await expect(modal.getByRole('button', { name: 'Preview import', exact: true })).toBeDisabled();
  await preview(modal, input, csv.replace('First item,3', 'First item,bad'));
  await expect(modal.getByText('Quantity must be a whole number from 0 to 2,147,483,647.')).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Import shipments', exact: true })).toHaveCount(0);
  await modal.getByLabel('Show rows with errors', { exact: true }).check();
  await expect(modal.getByText('Second item', { exact: true })).toHaveCount(0);
  await preview(modal, input);
  await expect(modal.getByText('2 shipments · 2 item rows · Ready to import')).toBeVisible();
  await input.fill(csv + '\n');
  await expect(modal.getByRole('button', { name: 'Import shipments', exact: true })).toHaveCount(0);
  await preview(modal, input);
  const reads = state.reads;
  await modal.getByRole('button', { name: 'Import shipments', exact: true }).click();
  await expect(page.getByText('Imported', { exact: true })).toBeVisible(); await expect(modal).toHaveCount(0);
  expect(state.writes).toHaveLength(1); expect(state.writes[0].csv).toBe(csv); expect(state.writes[0].fingerprint).toHaveLength(64);
  await expect.poll(() => state.reads).toBeGreaterThan(reads); expect(state.errors).toEqual([]);
});
test('Lost response retries the same batch, preserves locked CSV, and survives a failed refresh', async ({ page }) => {
  const { state, modal, input } = await fixture(page); await preview(modal, input); state.mode = 'lost';
  await modal.getByRole('button', { name: 'Import shipments', exact: true }).click();
  await expect(modal.getByRole('button', { name: 'Retry import', exact: true })).toBeVisible();
  await expect(input).toHaveValue(csv); await expect(input).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(page.getByText(/This batch may already be saved/)).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  state.mode = 'reject'; await modal.getByRole('button', { name: 'Retry import', exact: true }).click();
  await expect(input).toBeDisabled(); // a later rejection cannot erase the earlier uncertain commit
  state.mode = 'success'; state.failRead = true;
  await modal.getByRole('button', { name: 'Retry import', exact: true }).click();
  await expect(page.getByText('Import confirmed', { exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(3); expect(state.writes[1]).toEqual(state.writes[0]); expect(state.writes[2]).toEqual(state.writes[0]);
  expect(state.saved.size).toBe(1); expect(state.errors).toEqual([]);
});
test('Preview and definitive import failures keep editable CSV; pending imports block closing', async ({ page }) => {
  const { state, modal, input } = await fixture(page); state.previewFail = true; await input.fill(csv);
  await modal.getByRole('button', { name: 'Preview import', exact: true }).click();
  await expect(modal.getByRole('alert')).toContainText('Your CSV is still here'); await expect(input).toHaveValue(csv);
  state.previewFail = false; await preview(modal, input); state.mode = 'reject';
  await modal.getByRole('button', { name: 'Import shipments', exact: true }).click();
  await expect(input).toBeEnabled(); await expect(input).toBeFocused(); await expect(input).toHaveValue(csv);
  await preview(modal, input); state.mode = 'held';
  await modal.getByRole('button', { name: 'Import shipments', exact: true }).click();
  await expect.poll(() => Boolean(state.release)).toBe(true); await expect(input).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(modal.getByText('Saving. Please wait before leaving this form.')).toBeVisible();
  expect(state.writes[1].idempotencyKey).not.toBe(state.writes[0].idempotencyKey);
  state.release(); await expect(modal).toHaveCount(0); expect(state.writes).toHaveLength(2);
});
test('CSV draft warns on Cancel, Back and refresh; mobile preview stays inside the modal', async ({ page }, info) => {
  const { modal, input } = await fixture(page); await page.setViewportSize({ width: 390, height: 844 }); await preview(modal, input);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('inbound-import-preview-mobile.png'), fullPage: true });
  await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click(); await expect(input).toHaveValue(csv);
  const warning = page.waitForEvent('dialog'); await page.evaluate(() => { setTimeout(() => location.reload(), 0); });
  const dialog = await warning; expect(dialog.type()).toBe('beforeunload'); await dialog.dismiss();
  await expect(input).toHaveValue(csv);
  await page.goBack(); await expect(page.getByRole('dialog', { name: 'Discard unsaved changes?' })).toBeVisible();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click(); await expect(page).toHaveURL(/\/inventory$/);
});
test('Large previews show every row through preview pagination', async ({ page }) => {
  const { modal, input } = await fixture(page);
  const many = 'client,reference,sku,qty\n' + Array.from({ length: 51 }, (_, i) => `Alpha,PO-${i},SKU-${i},1`).join('\n');
  await preview(modal, input, many);
  await expect(modal.getByText('SKU-50', { exact: true })).toHaveCount(0);
  await modal.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(modal.getByText('SKU-50', { exact: true })).toBeVisible();
});
