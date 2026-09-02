/**
 * CP-068 — clicking Export in the real portal UI downloads PrepShip's workbook, byte for byte.
 *
 * Deterministic: `/api/client-portal/invoice.xlsx` is intercepted and answered with the
 * committed fixture PrepShip's real renderer produced (fixtures/cp-068-prepship-invoice-
 * workbook.xlsx), under the filename PrepShip names. Every assertion is about what the
 * BROWSER does with those bytes: the request it sends (one client, plain days, the caller's
 * bearer), the file it saves (sha256-identical, same name), and what it must NOT do (assemble
 * anything when the page spans several clients).
 *
 * Nothing here depends on production data and no PrepShip instance is contacted.
 * Self-contained, like client-portal-cp059-billing.spec.js, for the same reason.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const baseUrl = 'http://127.0.0.1:5177';
const storageKey = 'sb-portal-e2e-auth-token';

const FIXTURE_BYTES = readFileSync('fixtures/cp-068-prepship-invoice-workbook.xlsx');
const FIXTURE = JSON.parse(readFileSync('fixtures/cp-068-prepship-invoice-workbook.json', 'utf8'));
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PREPSHIP_FILENAME = 'invoice-CP068-Fixture-Client-2026-08-01-2026-08-31.xlsx';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const encodeJwtPart = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

const adminToken = () => [
  encodeJwtPart({ alg: 'HS256', typ: 'JWT' }),
  encodeJwtPart({
    aud: 'authenticated',
    exp: 4_102_444_800,
    sub: 'e2e-admin',
    email: 'admin@portal-e2e.test',
    role: 'authenticated',
    app_metadata: { role: 'admin', permissions: ['scope:global'] },
  }),
  'e2e-signature',
].join('.');

const adminSession = () => ({
  access_token: adminToken(),
  refresh_token: 'e2e-refresh-token',
  expires_in: 2_147_483_647,
  expires_at: 4_102_444_800,
  token_type: 'bearer',
  user: {
    id: 'e2e-admin',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'admin@portal-e2e.test',
    email_confirmed_at: '2026-01-01T00:00:00.000Z',
    last_sign_in_at: '2026-07-10T00:00:00.000Z',
    app_metadata: { provider: 'email', providers: ['email'], role: 'admin', permissions: ['scope:global'] },
    user_metadata: {},
  },
});

const period = (clientId, clientName) => ({
  clientId, clientName, orders: 3,
  pickpackTotal: 2.5, additionalTotal: 0, packageTotal: 0,
  shippingTotal: 6.1, storageTotal: 0,
  returnPostageTotal: 7.73, returnProcessingTotal: 3, rowTotal: 25.03,
  periodStart: '2026-08-01', periodEnd: '2026-08-31',
});

/**
 * Stub every portal API. `clients` decides how many clients the Billing page spans, which is
 * what "Export all" keys on. Every /invoice.xlsx request is recorded so the test can assert
 * what reached the wire — or that nothing did.
 */
async function setupBilling(page, clients) {
  const errors = [];
  const exportRequests = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    { key: storageKey, value: adminSession() },
  );

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/client-portal/invoice.xlsx') {
      exportRequests.push({
        search: url.search,
        authorization: request.headers()['authorization'] ?? null,
      });
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': XLSX_TYPE,
          'content-disposition': `attachment; filename="${PREPSHIP_FILENAME}"`,
          'x-content-type-options': 'nosniff',
          'cache-control': 'no-store',
        },
        body: FIXTURE_BYTES,
      });
      return;
    }
    if (url.pathname.startsWith('/api/client-portal/')) {
      let body = { data: [], billingVisible: true };
      if (url.pathname.includes('invoice-summary')) {
        const rows = clients.map((client) => period(client.id, client.name));
        body = {
          data: rows,
          totals: {
            orders: 3 * rows.length, pickpackTotal: 2.5 * rows.length, additionalTotal: 0, packageTotal: 0,
            storageTotal: 0, shippingTotal: 6.1 * rows.length,
            returnPostageTotal: 7.73 * rows.length, returnProcessingTotal: 3 * rows.length,
            rowTotal: 25.03 * rows.length,
          },
          billingVisible: true,
        };
      } else if (url.pathname.endsWith('/clients')) {
        body = { data: clients.map((client) => ({ id: client.id, name: client.name })) };
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      return;
    }
    if (url.origin === baseUrl) { await route.continue(); return; }
    await route.abort('blockedbyclient');
  });
  return { errors, exportRequests };
}

async function openBilling(page) {
  await page.goto(`${baseUrl}/billing`);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('body')).toContainText('Acme');
}

test('the fixture is what its sidecar says it is', async () => {
  expect(sha256(FIXTURE_BYTES)).toBe(FIXTURE.sha256);
  expect(FIXTURE.producerSha).toMatch(/^[0-9a-f]{40}$/);
});

test('clicking a period\'s Export downloads PrepShip\'s bytes under PrepShip\'s filename', async ({ page }) => {
  const { errors, exportRequests } = await setupBilling(page, [{ id: 1, name: 'Acme' }]);
  await openBilling(page);

  const exportButton = page.getByTitle('Download this billing period as Excel (.xlsx)').first();
  await expect(exportButton).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await exportButton.click();
  const download = await downloadPromise;

  // The request: one client, the period's DAYS, the caller's own bearer.
  expect(exportRequests).toHaveLength(1);
  const params = new URLSearchParams(exportRequests[0].search);
  expect(params.get('clientId')).toBe('1');
  expect(params.get('dateFrom')).toBe('2026-08-01');
  expect(params.get('dateTo')).toBe('2026-08-31');
  expect(exportRequests[0].authorization).toBe(`Bearer ${adminToken()}`);

  // The file: PrepShip's name, PrepShip's bytes — sha256-identical to the committed fixture.
  expect(download.suggestedFilename()).toBe(PREPSHIP_FILENAME);
  const saved = readFileSync(await download.path());
  expect(saved.byteLength).toBe(FIXTURE_BYTES.byteLength);
  expect(sha256(saved)).toBe(FIXTURE.sha256);

  await expect(page.locator('body')).toContainText('Excel ready');
  expect(errors, `console/page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('"Export all" on a single-client page downloads that client\'s whole-range workbook', async ({ page }) => {
  const { errors, exportRequests } = await setupBilling(page, [{ id: 1, name: 'Acme' }]);
  await openBilling(page);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export all' }).click();
  const download = await downloadPromise;

  expect(exportRequests).toHaveLength(1);
  const params = new URLSearchParams(exportRequests[0].search);
  expect(params.get('clientId')).toBe('1');
  expect(params.get('dateFrom')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(params.get('dateTo')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(download.suggestedFilename()).toBe(PREPSHIP_FILENAME);
  expect(sha256(readFileSync(await download.path()))).toBe(FIXTURE.sha256);
  expect(errors, `console/page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('"Export all" across several clients asks for a client and assembles nothing', async ({ page }) => {
  const { errors, exportRequests } = await setupBilling(page, [
    { id: 1, name: 'Acme' },
    { id: 2, name: 'Bolt' },
  ]);
  await openBilling(page);
  await expect(page.locator('body')).toContainText('Bolt');

  await page.getByRole('button', { name: 'Export all' }).click();
  await expect(page.locator('body')).toContainText('Choose a client to export');

  // No workbook was requested and nothing was downloaded: the merged form is a DJ decision.
  expect(exportRequests).toHaveLength(0);
  expect(errors, `console/page errors: ${errors.join(' | ')}`).toEqual([]);
});
