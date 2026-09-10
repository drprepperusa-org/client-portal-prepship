/**
 * CP-070 — the Billing finalization banner in the real portal.
 *
 * Every portal API is intercepted. The finalization verdict is PrepShip's; these tests control
 * what the portal API answers and prove only what the BROWSER does with it: exact copy above the
 * totals, no cached or out-of-order `closed` presented as current, unavailable on failure, a
 * fresh confirmation on re-entry, the same applied days as the totals in any timezone, and
 * nothing requested for accounts that cannot see billing. No production data, no generation.
 */
import { expect, test } from '@playwright/test';

const baseUrl = 'http://127.0.0.1:5177';
const storageKey = 'sb-portal-e2e-auth-token';
const COVERAGE_PATH = '/api/client-portal/billing/finalization-coverage';

const OPEN_COPY = 'Billing not finalized — Charges for this period are preliminary and may change. Your final invoice will be available once DR PREPPER completes billing.';
const MIXED_COPY = 'This view includes unfinalized charges.';
const UNAVAILABLE_COPY = 'Unable to confirm billing finalization.';
const CHECKING_COPY = 'Checking billing finalization…';

const encodeJwtPart = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const adminToken = () => [
  encodeJwtPart({ alg: 'HS256', typ: 'JWT' }),
  encodeJwtPart({
    aud: 'authenticated', exp: 4_102_444_800, sub: 'e2e-admin', email: 'admin@portal-e2e.test',
    role: 'authenticated', app_metadata: { role: 'admin', permissions: ['scope:global'] },
  }),
  'e2e-signature',
].join('.');
const adminSession = () => ({
  access_token: adminToken(), refresh_token: 'e2e-refresh-token',
  expires_in: 2_147_483_647, expires_at: 4_102_444_800, token_type: 'bearer',
  user: {
    id: 'e2e-admin', aud: 'authenticated', role: 'authenticated', email: 'admin@portal-e2e.test',
    email_confirmed_at: '2026-01-01T00:00:00.000Z', last_sign_in_at: '2026-07-10T00:00:00.000Z',
    app_metadata: { provider: 'email', providers: ['email'], role: 'admin', permissions: ['scope:global'] },
    user_metadata: {},
  },
});

/** A session for any user, with a distinct access token per `salt`. */
const sessionFor = (userId, email, salt) => {
  const base = adminSession();
  return {
    ...base,
    access_token: [
      encodeJwtPart({ alg: 'HS256', typ: 'JWT' }),
      encodeJwtPart({
        aud: 'authenticated', exp: 4_102_444_800, sub: userId, email, session_id: salt,
        role: 'authenticated', app_metadata: { role: 'admin', permissions: ['scope:global'] },
      }),
      'e2e-signature',
    ].join('.'),
    user: { ...base.user, id: userId, email },
  };
};

/**
 * Deterministic auth-event seam: supabase-js relays auth events between tabs on a BroadcastChannel
 * named after its storage key and hands them to onAuthStateChange subscribers. Posting one here
 * drives the REAL AuthProvider -> useAuth -> query-key lifecycle, with no live token refresh and
 * no test-only code in the app.
 */
const broadcastAuth = (page, event, session) => page.evaluate(({ key, event, session }) => {
  const channel = new BroadcastChannel(key);
  channel.postMessage({ event, session });
  channel.close();
}, { key: storageKey, event, session });

const CLIENTS = [{ id: 1, name: 'Acme' }, { id: 2, name: 'Beta' }];
const summary = (url) => ({
  data: [{
    clientId: 1, clientName: 'Acme', orders: 3, pickpackTotal: 7.5, additionalTotal: 0,
    packageTotal: 0, shippingTotal: 6.1, storageTotal: 0, rowTotal: 13.6,
    periodStart: url.searchParams.get('dateFrom') ?? '2026-08-01',
    periodEnd: url.searchParams.get('dateTo') ?? '2026-08-15',
  }],
  totals: { orders: 3, pickpackTotal: 7.5, additionalTotal: 0, packageTotal: 0, storageTotal: 0, shippingTotal: 6.1, rowTotal: 13.6 },
  billingVisible: true,
});

/** An answer for exactly the days the request asked about, as the portal API would issue it. */
const verdict = (url, status, extra = {}) => ({
  body: { status, dateFrom: url.searchParams.get('dateFrom'), dateTo: url.searchParams.get('dateTo'), today: '2026-09-11' },
  ...extra,
});

/**
 * Intercepts every portal API. `coverage(url, n)` decides each finalization answer; it may
 * return { status, body, delayMs }.
 */
async function setupBilling(page, coverage, { summaryStatus = 200 } = {}) {
  const requests = { coverage: [], summary: [] };
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    { key: storageKey, value: adminSession() },
  );
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === COVERAGE_PATH) {
      const authorization = route.request().headers()['authorization'] ?? null;
      requests.coverage.push({ ...Object.fromEntries(url.searchParams), authorization });
      const answer = await coverage(url, requests.coverage.length, authorization);
      if (answer.delayMs) await new Promise((resolve) => setTimeout(resolve, answer.delayMs));
      await route.fulfill({
        status: answer.status ?? 200, contentType: 'application/json', body: JSON.stringify(answer.body ?? {}),
      }).catch(() => {});
      return;
    }
    if (url.pathname.startsWith('/api/client-portal/')) {
      let status = 200;
      let body = { data: [], billingVisible: true };
      if (url.pathname.includes('invoice-summary')) {
        requests.summary.push(Object.fromEntries(url.searchParams));
        if (summaryStatus !== 200) { status = summaryStatus; body = { error: 'Billing access required' }; }
        else body = summary(url);
      } else if (url.pathname.endsWith('/clients')) {
        body = { data: CLIENTS };
      }
      await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {});
      return;
    }
    if (url.origin === baseUrl) { await route.continue(); return; }
    await route.abort('blockedbyclient');
  });
  return { requests, errors };
}

const banner = (page) => page.getByTestId('billing-finalization-banner');
const periodsHeading = (page) => page.getByText('Billing periods', { exact: true });
const clientFilter = (page) => page.getByLabel('Filter billing periods by client');

test.describe('CP-070 AC-1 — banner copy and placement', () => {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    test(`open verdict sits above the totals and billing stays usable (${viewport.width}px)`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const { requests, errors } = await setupBilling(page, (url) => verdict(url, 'open'));
      await page.goto(`${baseUrl}/billing`);
      await expect(banner(page)).toHaveAttribute('data-state', 'open');
      await expect(banner(page)).toHaveText(OPEN_COPY);
      await expect(banner(page)).toHaveAttribute('role', 'status');
      const bannerBox = await banner(page).boundingBox();
      const listBox = await periodsHeading(page).boundingBox();
      expect(bannerBox && listBox && bannerBox.y + bannerBox.height <= listBox.y).toBeTruthy();

      // Nonblocking: the list still responds, and the banner stays.
      const before = requests.summary.length;
      await page.getByRole('button', { name: 'Monthly', exact: true }).click();
      await expect.poll(() => requests.summary.length).toBeGreaterThan(before);
      await expect(banner(page)).toHaveText(OPEN_COPY);
      expect(errors).toEqual([]);
    });
  }

  test('mixed verdict shows the mixed copy', async ({ page }) => {
    await setupBilling(page, (url) => verdict(url, 'mixed'));
    await page.goto(`${baseUrl}/billing`);
    await expect(banner(page)).toHaveAttribute('data-state', 'mixed');
    await expect(banner(page)).toHaveText(MIXED_COPY);
  });

  test('closed verdict shows no banner, and a pending check is visible, not silent', async ({ page }) => {
    await setupBilling(page, (url) => verdict(url, 'closed', { delayMs: 1500 }));
    await page.goto(`${baseUrl}/billing`);
    await expect(banner(page)).toHaveText(CHECKING_COPY);
    await expect(banner(page)).toHaveCount(0, { timeout: 10_000 });
  });

  test('unavailable offers Retry, and Retry re-confirms', async ({ page }) => {
    let failing = true;
    const { requests } = await setupBilling(page, (url) => (failing
      ? { status: 502, body: { error: UNAVAILABLE_COPY } }
      : verdict(url, 'closed')));
    await page.goto(`${baseUrl}/billing`);
    await expect(banner(page)).toHaveAttribute('data-state', 'unavailable', { timeout: 20_000 });
    await expect(banner(page)).toContainText(UNAVAILABLE_COPY);
    failing = false;
    const before = requests.coverage.length;
    await banner(page).getByRole('button', { name: 'Retry' }).click();
    await expect.poll(() => requests.coverage.length).toBeGreaterThan(before);
    await expect(banner(page)).toHaveCount(0, { timeout: 10_000 });
  });

  test('a producer answer for other days is never shown as this view\'s verdict', async ({ page }) => {
    await setupBilling(page, (url) => ({ body: { ...verdict(url, 'closed').body, dateFrom: '1999-01-01' } }));
    await page.goto(`${baseUrl}/billing`);
    await expect(banner(page)).toHaveAttribute('data-state', 'unavailable');
  });
});

test.describe('CP-070 AC-3 — no stale verdict', () => {
  test('a delayed closed for the old scope never replaces the new scope\'s open verdict', async ({ page }) => {
    const { requests } = await setupBilling(page, (url) => (url.searchParams.get('clientId') === '2'
      ? verdict(url, 'open')
      : verdict(url, 'closed', { delayMs: 2500 })));
    await page.goto(`${baseUrl}/billing`);
    await clientFilter(page).selectOption('2');
    await expect(banner(page)).toHaveAttribute('data-state', 'open');
    await page.waitForTimeout(3000);
    await expect(banner(page)).toHaveAttribute('data-state', 'open');
    expect(requests.coverage.some((params) => params.clientId === '2')).toBeTruthy();
  });

  test('returning to a cached closed scope re-confirms instead of trusting the cache', async ({ page }) => {
    let scopeAnswers = 0;
    await setupBilling(page, (url) => {
      if (url.searchParams.get('clientId') === '2') return verdict(url, 'open');
      scopeAnswers += 1;
      return verdict(url, 'closed', { delayMs: scopeAnswers === 1 ? 0 : 2000 });
    });
    await page.goto(`${baseUrl}/billing`);
    await expect(banner(page)).toHaveCount(0, { timeout: 10_000 });
    await clientFilter(page).selectOption('2');
    await expect(banner(page)).toHaveAttribute('data-state', 'open');
    await clientFilter(page).selectOption('');
    // The cached closed answer is not current confirmation: a check is shown until it lands.
    await expect(banner(page)).toHaveText(CHECKING_COPY);
    await expect(banner(page)).toHaveCount(0, { timeout: 10_000 });
  });

  test('a cached closed verdict followed by a failed refresh is unavailable, not silent', async ({ page }) => {
    let failing = false;
    const { requests } = await setupBilling(page, (url) => (failing
      ? { status: 502, body: { error: UNAVAILABLE_COPY } }
      : verdict(url, 'closed')));
    await page.goto(`${baseUrl}/billing`);
    await expect(banner(page)).toHaveCount(0, { timeout: 10_000 });
    failing = true;
    const before = requests.coverage.length;
    await page.evaluate(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    await expect.poll(() => requests.coverage.length).toBeGreaterThan(before);
    await expect(banner(page)).toHaveAttribute('data-state', 'unavailable', { timeout: 20_000 });
  });

  test('re-entering Billing after an operator finalizes shows the new verdict', async ({ page }) => {
    let finalized = false;
    await setupBilling(page, (url) => verdict(url, finalized ? 'closed' : 'open'));
    await page.goto(`${baseUrl}/billing`);
    await expect(banner(page)).toHaveAttribute('data-state', 'open');
    finalized = true;
    await page.locator('a[href="/orders"]').first().click();
    await expect(page).toHaveURL(/\/orders/);
    await page.locator('a[href="/billing"]').first().click();
    await expect(page).toHaveURL(/\/billing/);
    await expect(banner(page)).toHaveCount(0, { timeout: 10_000 });
  });

  test('the drill-in never repeats the list-scope verdict as a period assertion', async ({ page }) => {
    await setupBilling(page, (url) => verdict(url, 'open'));
    await page.goto(`${baseUrl}/billing`);
    await expect(banner(page)).toHaveAttribute('data-state', 'open');
    await page.locator('tr').filter({ hasText: /Acme/ }).first().click();
    await expect(page.getByRole('button', { name: 'All periods' })).toBeVisible();
    await expect(banner(page)).toHaveCount(0);
    // Back on the list, the list-scope verdict returns.
    await page.getByRole('button', { name: 'All periods' }).click();
    await expect(banner(page)).toHaveAttribute('data-state', 'open');
  });
});

for (const timezoneId of ['America/Los_Angeles', 'UTC', 'Pacific/Kiritimati', 'Australia/Lord_Howe']) {
  test.describe(`CP-070 AC-4 — timezone parity (${timezoneId})`, () => {
    test.use({ timezoneId });
    test('the banner asks about exactly the days the totals show', async ({ page }) => {
      const { requests } = await setupBilling(page, (url) => verdict(url, 'open'));
      await page.goto(`${baseUrl}/billing`);
      await expect(banner(page)).toHaveAttribute('data-state', 'open');
      const lastSummary = requests.summary.at(-1);
      const lastCoverage = requests.coverage.at(-1);
      expect(lastCoverage.dateFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect([lastCoverage.dateFrom, lastCoverage.dateTo]).toEqual([lastSummary.dateFrom, lastSummary.dateTo]);
    });
  });
}

test('CP-070 AC-5 — an account that cannot see billing gets no banner and no finalization request', async ({ page }) => {
  const { requests } = await setupBilling(page, (url) => verdict(url, 'open'), { summaryStatus: 403 });
  await page.goto(`${baseUrl}/billing`);
  await expect(page.getByText('No billing available')).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(banner(page)).toHaveCount(0);
  expect(requests.coverage).toEqual([]);
});

test.describe('CP-070 AC-3 — auth transitions', () => {
  /** Waits until a verdict was actually fetched and settled closed, so "no banner" is not "not rendered yet". */
  async function settleClosed(page, requests) {
    await expect(periodsHeading(page)).toBeVisible();
    await expect.poll(() => requests.coverage.length).toBeGreaterThan(0);
    await expect(banner(page)).toHaveCount(0, { timeout: 10_000 });
  }

  test('an account switch never shows the previous user\'s closed verdict', async ({ page }) => {
    const other = sessionFor('e2e-other-admin', 'other-admin@portal-e2e.test', 'other-session');
    const otherBearer = `Bearer ${other.access_token}`;
    const { requests, errors } = await setupBilling(page, (url, _n, authorization) => (authorization === otherBearer
      ? verdict(url, 'open', { delayMs: 1500 })
      : verdict(url, 'closed')));
    await page.goto(`${baseUrl}/billing`);
    await settleClosed(page, requests);

    await broadcastAuth(page, 'SIGNED_IN', other);
    // The first user's closed verdict is gone: the new user sees a pending check, then their own answer.
    await expect(banner(page)).toHaveText(CHECKING_COPY);
    await expect(banner(page)).toHaveAttribute('data-state', 'open', { timeout: 10_000 });
    expect(requests.coverage.some((request) => request.authorization === otherBearer)).toBeTruthy();
    expect(errors).toEqual([]);
  });

  test('a same-user token change re-confirms with the new token instead of trusting the cached verdict', async ({ page }) => {
    const refreshed = sessionFor('e2e-admin', 'admin@portal-e2e.test', 'refreshed-session');
    const refreshedBearer = `Bearer ${refreshed.access_token}`;
    const { requests, errors } = await setupBilling(page, (url, _n, authorization) => (authorization === refreshedBearer
      ? verdict(url, 'closed', { delayMs: 1500 })
      : verdict(url, 'closed')));
    await page.goto(`${baseUrl}/billing`);
    await settleClosed(page, requests);

    await broadcastAuth(page, 'TOKEN_REFRESHED', refreshed);
    await expect.poll(() => requests.coverage.some((request) => request.authorization === refreshedBearer)).toBeTruthy();
    // Same user, new auth context: the closed verdict fetched under the old token is not current.
    await expect(banner(page)).toHaveText(CHECKING_COPY);
    await expect(banner(page)).toHaveCount(0, { timeout: 10_000 });
    expect(errors).toEqual([]);
  });
});
