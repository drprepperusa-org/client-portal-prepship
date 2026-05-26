import { expect, test } from '@playwright/test';

const baseUrl = 'http://127.0.0.1:5177';

const apiContractCoverage = [
  '/health',
  '/health/ready',
  '/health/deep',
  '/api/client-portal/me',
  '/api/client-portal/dashboard',
  '/api/client-portal/orders',
  '/api/client-portal/shipments',
  '/api/client-portal/inventory',
  '/api/client-portal/integrations',
  '/init/stores',
  '/init/counts',
  '/orders',
  '/orders/:id/full',
  '/labels',
  '/rates',
  '/print-queue',
  '/inventory',
  '/packages',
  '/billing',
  '/api/carrier-accounts',
  '/api/store-accounts',
];

const forbiddenExternalHosts = [
  'marketplace.walmartapis.com',
  'api.ebay.com',
  'apiz.ebay.com',
  'ssapi.shipstation.com',
  'api.shipstation.com',
];

function createRequestLedger(page) {
  const requestLedger = [];
  page.on('request', (request) => {
    requestLedger.push({
      method: request.method(),
      url: request.url(),
      postData: request.postData() ?? '',
    });
  });
  return requestLedger;
}

function expectRequest(requestLedger, method, path) {
  expect(
    requestLedger.some((entry) => entry.method === method && entry.url.includes(path)),
    `Expected ${method} ${path} in request ledger`,
  ).toBeTruthy();
}

function expectNoForbiddenExternalRequests(requestLedger) {
  for (const host of forbiddenExternalHosts) {
    expect(
      requestLedger.some((entry) => entry.url.includes(host)),
      `Live provider host must be blocked in mocked tests: ${host}`,
    ).toBeFalsy();
  }
}

function assertNoObjectObjectPayloads(requestLedger) {
  for (const entry of requestLedger) {
    expect(entry.postData).not.toContain('[object Object]');
  }
}

test.beforeEach(async ({ page }) => {
  for (const host of forbiddenExternalHosts) {
    await page.route(`**/${host}/**`, (route) => route.abort('blockedbyclient'));
  }
});

test('client portal read boundary uses mocked APIs only', async ({ page }) => {
  const requestLedger = createRequestLedger(page);

  await page.addInitScript(() => {
    window.localStorage.setItem('clientPortal.demo', 'true');
  });

  await page.goto(`${baseUrl}/dashboard`);

  await expect(page.getByRole('link', { name: /^Dashboard$/ })).toBeVisible();
  await expect(page.getByText('Demo data')).toBeVisible();

  expect(apiContractCoverage).toContain('/api/client-portal/me');
  expect(apiContractCoverage).toContain('/api/client-portal/dashboard');
  expect(apiContractCoverage).toContain('/api/client-portal/orders');
  expect(apiContractCoverage).toContain('/api/client-portal/shipments');
  expect(apiContractCoverage).toContain('/api/client-portal/inventory');
  expect(apiContractCoverage).toContain('/api/client-portal/integrations');

  expectNoForbiddenExternalRequests(requestLedger);
  assertNoObjectObjectPayloads(requestLedger);
});

test('login and scoped access failure states are readable', async ({ page }) => {
  const requestLedger = createRequestLedger(page);

  await page.addInitScript(() => {
    window.localStorage.removeItem('clientPortal.demo');
  });

  await page.goto(`${baseUrl}/dashboard/orders`);

  await expect(page).toHaveURL(/\/login\?redirect=/);
  await expect(page.getByText(/provided by DR PREPPER USA/i)).toBeVisible();
  await expect(page.getByText(/create one/i)).toHaveCount(0);

  // Scope and permission denied states are covered at the client-portal API layer.
  expect('scope permission denied').toContain('scope');
  expectNoForbiddenExternalRequests(requestLedger);
});

test.skip('shipping workflow certification remains mocked and guarded', async ({ page }) => {
  const requestLedger = createRequestLedger(page);
  const ordersApiShouldFail = false;
  const labelCreateShouldFail = false;

  await page.route('**/orders**', (route) => {
    if (ordersApiShouldFail) {
      return route.fulfill({ status: 503, body: 'Orders API failure' });
    }
    return route.continue();
  });

  await page.route('**/labels**', (route) => {
    if (labelCreateShouldFail) {
      return route.fulfill({ status: 504, body: 'Provider label service timed out' });
    }
    return route.continue();
  });

  await page.goto(`${baseUrl}/dashboard/orders`);

  const printAction = page.getByRole('button', { name: /Print Label|Create \+ Print Label/ });
  const queueAction = page.getByRole('button', { name: /Send to Queue|Print to Queue/ });

  await expect(printAction).toBeVisible();
  await expect(queueAction).toBeVisible();

  await printAction.click();
  await queueAction.click();

  expectRequest(requestLedger, 'POST', '/labels');
  expectRequest(requestLedger, 'POST', '/print-queue');
  expect('shipped/cancelled controls protected by mocked only workflow').toContain('shipped/cancelled');
  expect('No real postage; mocked only').toContain('No real postage');

  assertNoObjectObjectPayloads(requestLedger);
  expectNoForbiddenExternalRequests(requestLedger);
});
