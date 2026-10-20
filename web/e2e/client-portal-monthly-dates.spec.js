import { expect, test } from '@playwright/test';

const base = 'http://127.0.0.1:5177';

// All data and auth in these tests are local fixtures; no production requests.
async function setup(page, handle, admin = false) {
  await page.clock.setFixedTime(new Date('2026-10-20T12:00:00Z'));
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const user = { id: 'monthly-date-fixture', aud: 'authenticated', role: 'authenticated',
    email: 'dates@portal-e2e.test', app_metadata: {}, user_metadata: {} };
  await page.addInitScript(session => {
    localStorage.setItem('sb-portal-e2e-auth-token', JSON.stringify(session));
    // A previous saved layout must not override the new requested defaults.
    localStorage.setItem('prepship.tbl.returns.v1', JSON.stringify({
      order: ['returnReference', 'status', 'tracking', 'delivery', 'created'], hidden: [],
    }));
  }, { access_token: [encode({ alg: 'HS256', typ: 'JWT' }),
    encode({ ...user, sub: user.id, exp: 4102444800 }), 'fixture'].join('.'),
    refresh_token: 'fixture', expires_at: 4102444800, expires_in: 2147483647,
    token_type: 'bearer', user });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/client-portal/')) {
      if (url.searchParams.get('format') === 'csv') {
        handle(url);
        await route.fulfill({ contentType: 'text/csv', body: 'Return reference\r\nSEPT-RETURN\r\n' });
        return;
      }
      let body = handle(url) ?? { data: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 1 } };
      if (url.pathname.endsWith('/me')) body = { ...user, isAdmin: admin, isGlobal: admin,
        isRestricted: !admin, canViewFinancials: true, canCustomizeTables: admin,
        clientIds: [1], storeIds: [], canInspectReturns: false };
      if (url.pathname.endsWith('/clients')) body = { data: [{ id: 1, name: 'Fixture' }] };
      if (url.pathname.endsWith('/sync-status')) body = { status: 'ok', lastSyncAt: null };
      if (url.pathname.endsWith('/awaiting-active-count')) body = { count: 0 };
      await route.fulfill({ json: body });
    } else if (url.origin === base) await route.continue();
    else await route.abort();
  });
}

async function september(page) {
  await page.getByRole('button', { name: 'Date range filter', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Last month', exact: true }).click();
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
}

test('Billing uses monthly periods and shares toolbar and inline dates', async ({ page }) => {
  const requests = [];
  const detailRequests = [];
  await setup(page, url => {
    if (url.pathname.endsWith('/invoice-summary')) {
      requests.push(Object.fromEntries(url.searchParams));
      const start = url.searchParams.get('dateFrom');
      return { data: [{ clientId: 1, clientName: 'Fixture', periodStart: start,
        periodEnd: url.searchParams.get('dateTo'), orders: 1,
        rowTotal: 9.5 }], totals: { rowTotal: 9.5 }, billingVisible: true };
    }
    if (url.pathname.endsWith('/invoice-details')) {
      detailRequests.push(Object.fromEntries(url.searchParams));
      return { data: [], billingVisible: true };
    }
  });
  await page.goto(base + '/billing');
  await expect(page.getByRole('button', { name: 'Semi-Monthly', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Monthly', exact: true })).toHaveCount(0);
  await expect.poll(() => requests.at(-1)?.granularity).toBe('month');
  await september(page);
  await expect.poll(() => requests.at(-1)).toMatchObject({ dateFrom: '2026-09-01', dateTo: '2026-09-30', granularity: 'month' });
  await expect(page.getByRole('button', { name: 'Sep 1, 2026', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sep 30, 2026', exact: true })).toBeVisible();
  // Opening a period then changing the range must leave the old period detail.
  await page.getByRole('row', { name: /Sep 1.*Fixture/ }).click();
  await page.getByRole('button', { name: 'This Month', exact: true }).click();
  await expect.poll(() => requests.at(-1)).toMatchObject({ dateFrom: '2026-10-01', dateTo: '2026-10-20', granularity: 'month' });
  await expect(page.getByText('Billing periods', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Date range filter', exact: true })).toContainText('Oct 1 - Oct 20, 2026');
  await page.getByRole('button', { name: 'Date range filter', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('FROM', { exact: true }).fill('2026-09-10');
  await dialog.getByLabel('TO', { exact: true }).fill('2026-09-12');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect.poll(() => requests.at(-1)).toMatchObject({ dateFrom: '2026-09-10', dateTo: '2026-09-12', granularity: 'month' });
  await expect(page.getByRole('button', { name: 'Sep 10, 2026', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sep 12, 2026', exact: true })).toBeVisible();
  await page.getByRole('row', { name: /Sep 10.*Fixture/ }).click();
  await expect.poll(() => detailRequests.at(-1)).toMatchObject({ dateFrom: '2026-09-10', dateTo: '2026-09-12', clientId: '1' });
});

test('Returns dates reset pagination and also filter CSV; columns start with Created', async ({ page }) => {
  const requests = [];
  await setup(page, url => {
    if (!url.pathname.endsWith('/returns')) return;
    const params = Object.fromEntries(url.searchParams);
    requests.push(params);
    const pageNumber = Number(params.page ?? 1);
    const isSeptember = params.dateFrom === '2026-09-01T00:00:00.000Z';
    return { data: [{ id: 1, returnReference: isSeptember ? 'SEPT-RETURN' : 'OCT-RETURN',
      orderNumber: '4052', returnedSkus: ['HU-10'], returnedQuantity: 1, status: 'requested',
      trackingNumber: 'TRACK-FIXTURE', deliveryMethod: 'manual_pdf', createdAt: isSeptember ? '2026-09-30T23:59:59.999Z' : '2026-10-19T00:00:00Z' }],
      pagination: { page: pageNumber, pageSize: 50, total: 51, totalPages: 2 } };
  }, true);
  await page.goto(base + '/returns');
  const table = page.locator('table');
  await expect(table.locator('thead th').first()).toHaveText('Created');
  await expect(table.locator('thead th').nth(1)).toHaveText('Return ref');
  for (const name of ['Status', 'Delivery', 'Tracking #']) {
    await expect(table.getByRole('columnheader').filter({ has: page.getByRole('button', { name, exact: true }) })).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect.poll(() => requests.at(-1)?.page).toBe('2');
  await september(page);
  await expect(table).toContainText('SEPT-RETURN');
  await expect(table).not.toContainText('OCT-RETURN');
  await expect.poll(() => requests.at(-1)).toMatchObject({ page: '1', dateFrom: '2026-09-01T00:00:00.000Z', dateTo: '2026-09-30T23:59:59.999Z' });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
  await download;
  expect(requests.at(-1)).toMatchObject({ format: 'csv', dateFrom: '2026-09-01T00:00:00.000Z', dateTo: '2026-09-30T23:59:59.999Z' });
  await page.getByRole('button', { name: /^Columns/ }).click();
  for (const name of ['Status', 'Delivery', 'Tracking #']) {
    await page.getByRole('group', { name: 'Table column controls' }).getByRole('button', { name, exact: true }).click();
    await expect(table.getByRole('columnheader').filter({ has: page.getByRole('button', { name, exact: true }) })).toBeVisible();
  }
  await expect(table).toContainText('TRACK-FIXTURE');
});
