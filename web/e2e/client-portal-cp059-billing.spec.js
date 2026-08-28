/**
 * CP-059 — canonical billing event rows in the real portal UI.
 *
 * Deterministic: the `/api/client-portal/invoice-details` response is stubbed with exactly the
 * rows PrepShip would issue, so every assertion is about what the BROWSER does with canonical
 * truth. Nothing here depends on production data, and no return or postage is ever purchased.
 *
 * Deliberately self-contained rather than importing helpers from client-portal-ui.spec.js —
 * PR #30 edits that file, and a shared helper would make these two changes collide over a
 * surface that has nothing to do with either.
 */
import { expect, test } from '@playwright/test';

const baseUrl = 'http://127.0.0.1:5177';
const storageKey = 'sb-portal-e2e-auth-token';

const encodeJwtPart = (value) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

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

/** One canonical event row, shaped exactly as PrepShip issues it. */
const canonical = (over = {}) => ({
  clientId: 1,
  clientName: 'Acme',
  orderId: 4242,
  orderNumber: '4242',
  returnId: null,
  rowType: 'Outbound',
  displayReference: '4242',
  destination: 'Domestic',
  hasReturnPostageLine: false,
  hasReturnProcessingLine: false,
  pickpackTotal: 2.5,
  additionalTotal: 0,
  packageTotal: 0,
  shippingTotal: 6.1,
  storageTotal: 0,
  returnPostageTotal: null,
  returnProcessingTotal: null,
  returnTotal: null,
  rowTotal: 8.6,
  shipDate: '2026-08-01',
  actualActivityDate: '2026-08-01',
  billingEffectiveDate: '2026-08-01',
  skus: 'SKU-A',
  itemNames: 'Widget A',
  boxSize: 'Small',
  qty: 1,
  ...over,
});

/**
 * The fixture set the acceptance matrix asks for, in one response:
 * an outbound, its first return carrying 7.73 + 3.00, a second return with NO postage line,
 * and an international order whose return stays International.
 */
const EVENT_ROWS = [
  canonical({ rowType: 'Outbound', displayReference: '4242', destination: 'Domestic' }),
  canonical({
    rowType: 'Return', returnId: 9001, displayReference: '4242-RETURN', destination: 'Domestic',
    hasReturnPostageLine: true, returnPostageTotal: 7.73,
    hasReturnProcessingLine: true, returnProcessingTotal: 3.0,
    returnTotal: 10.73, rowTotal: 10.73,
  }),
  canonical({
    rowType: 'Return', returnId: 9002, displayReference: '4242-RETURN-2', destination: 'Domestic',
    // Absent, NOT zero. Must render blank rather than $0.00.
    hasReturnPostageLine: false, returnPostageTotal: null,
    hasReturnProcessingLine: true, returnProcessingTotal: 3.0,
    returnTotal: 3.0, rowTotal: 3.0,
  }),
  canonical({
    orderId: 5150, orderNumber: '5150', rowType: 'Outbound',
    displayReference: '5150', destination: 'International', rowTotal: 12.4,
  }),
  canonical({
    orderId: 5150, orderNumber: '5150', rowType: 'Return', returnId: 9003,
    displayReference: '5150-RETURN',
    // AC-3: the parcel is travelling to a US warehouse; the row stays International.
    destination: 'International',
    hasReturnPostageLine: true, returnPostageTotal: 4.25, returnTotal: 4.25, rowTotal: 4.25,
  }),
  canonical({
    orderId: 6001, orderNumber: '6001', rowType: 'Outbound',
    displayReference: '6001', destination: 'Needs Review', rowTotal: 5.0,
  }),
];

async function setupBilling(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    { key: storageKey, value: adminSession() },
  );

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/client-portal/')) {
      let body = { data: [], billingVisible: true };
      if (url.pathname.includes('invoice-details')) {
        body = { data: EVENT_ROWS, billingVisible: true };
      } else if (url.pathname.includes('invoice-summary')) {
        // The Billing page renders PERIODS first and the event rows are a drill-in, so a
        // period has to exist before any detail row can be reached. Its money is the
        // canonical sum of the fixture rows, which is what a real backend would return.
        body = {
          data: [{
            clientId: 1, clientName: 'Acme', orders: 6,
            pickpackTotal: 15, additionalTotal: 0, packageTotal: 0,
            shippingTotal: 6.1, storageTotal: 0,
            returnPostageTotal: 11.98, returnProcessingTotal: 6, rowTotal: 43.73,
            ...(url.searchParams.get('groupBy') === 'period'
              ? { periodStart: '2026-08-01', periodEnd: '2026-08-31' }
              : {}),
          }],
          totals: {
            orders: 6, pickpackTotal: 15, additionalTotal: 0, packageTotal: 0,
            storageTotal: 0, shippingTotal: 6.1,
            returnPostageTotal: 11.98, returnProcessingTotal: 6, rowTotal: 43.73,
          },
          billingVisible: true,
        };
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      return;
    }
    if (url.origin === baseUrl) { await route.continue(); return; }
    await route.abort('blockedbyclient');
  });
  return errors;
}

/**
 * Open the period drill-in so the canonical event rows are on screen.
 *
 * Asserting on the Billing landing page would pass or fail on the SUMMARY, which is a
 * different contract. CP-059 is about the detail rows, so the test has to get to them.
 */
async function openDetailRows(page) {
  await page.goto(`${baseUrl}/billing`);
  await page.waitForLoadState('networkidle');
  const drillIn = page.locator('button, a, tr').filter({ hasText: /Acme/ }).first();
  if (await drillIn.count()) {
    await drillIn.click().catch(() => {});
    await page.waitForLoadState('networkidle');
  }
}

test('AC-1/AC-2/AC-3: canonical references, Type and Destination render as issued', async ({ page }) => {
  const errors = await setupBilling(page);
  await openDetailRows(page);

  const body = page.locator('body');

  // AC-1 — the backend's own reference strings, verbatim, as SEPARATE rows.
  await expect(body).toContainText('4242-RETURN');
  await expect(body).toContainText('4242-RETURN-2');

  // AC-2/AC-3 — backend classification only. 'Needs Review' is rendered as a real value.
  await expect(body).toContainText('International');
  await expect(body).toContainText('Needs Review');

  // The columns exist at all.
  await expect(body).toContainText('Reference');
  await expect(body).toContainText('Destination');

  expect(errors, `console/page errors: ${errors.join(' | ')}`).toEqual([]);
});

test('AC-5: an absent return-postage line renders blank, never a fabricated $0.00', async ({ page }) => {
  await setupBilling(page);
  await openDetailRows(page);

  // 4242-RETURN-2 carries NO postage line and a real 3.00 processing line. The processing
  // money must be visible; the postage cell must not have invented a zero.
  const row = page.locator('tr', { hasText: '4242-RETURN-2' }).first();
  await expect(row).toBeVisible();
  const text = (await row.innerText()).replace(/\s+/g, ' ');
  expect(text, `RETURN-2 row rendered: ${text}`).toContain('3.00');
  expect(
    /\$?0\.00/.test(text),
    `an absent return-postage line must not render as 0.00 — row was: ${text}`,
  ).toBe(false);
});

test('AC-1: a Return reference does not open the outbound shipment drawer', async ({ page }) => {
  await setupBilling(page);
  await openDetailRows(page);

  // The Return shares orderId 4242 with the outbound. Routing by orderId would open the
  // OUTBOUND shipment from this row and show a customer a different shipment's money.
  const returnRow = page.locator('tr', { hasText: '4242-RETURN' }).first();
  await expect(returnRow).toBeVisible();
  const clickableReturn = returnRow.locator('button', { hasText: '4242-RETURN' });
  await expect(
    clickableReturn,
    'a Return reference must not be a button that opens the outbound shipment drawer',
  ).toHaveCount(0);

  // The outbound reference REMAINS interactive. Without this the test would also pass if
  // every reference had simply been made inert, which is not the fix — it is a different bug.
  // Targeted by role and exact name so it cannot accidentally match the '4242-RETURN' rows or
  // a column-header button.
  // Matched on the accessible name, which is the button's aria-label — not its text — so this
  // cannot accidentally match a '4242-RETURN' cell or a column-header sort button.
  await expect(
    page.getByRole('button', { name: 'View shipment information for order 4242' }),
    'the OUTBOUND reference must still open its shipment drawer',
  ).toBeVisible();

  // And the Return rows carry no such control at all.
  await expect(
    page.getByRole('button', { name: /View shipment information for order 4242-RETURN/ }),
    'no Return row may expose a shipment-drawer control',
  ).toHaveCount(0);
});
