import { expect, test } from '@playwright/test';
import { BILLING_COLUMN_SECTIONS } from '../../src/lib/client-portal/contracts/billing-columns';

const base = 'http://127.0.0.1:5177';
const initial = () => ({
  summary: BILLING_COLUMN_SECTIONS.summary.map(([key]) => key),
  lineItems: BILLING_COLUMN_SECTIONS.lineItems.map(([key]) => key), revision: null,
});
function session(admin) {
  const user = { id: admin ? 'column-admin' : 'column-client', email: admin ? 'admin@columns.test' : 'client@columns.test',
    aud: 'authenticated', role: 'authenticated', app_metadata: { role: admin ? 'admin' : 'client_user', permissions: admin ? ['scope:global'] : ['financials:read'], client_ids: admin ? [] : [4] } };
  const enc = (part) => Buffer.from(JSON.stringify(part)).toString('base64url');
  return { access_token: [enc({ alg: 'HS256', typ: 'JWT' }), enc({ sub: user.id, exp: 4102444800, email: user.email, role: 'authenticated', app_metadata: user.app_metadata }), 'test'].join('.'),
    refresh_token: 'test', expires_at: 4102444800, expires_in: 2147483647, token_type: 'bearer', user };
}

async function setup(context, admin, state) {
  await context.addInitScript((value) => localStorage.setItem('sb-portal-e2e-auth-token', JSON.stringify(value)), session(admin));
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/client-portal/')) {
      let body = { data: [] };
      if (url.pathname.endsWith('/me')) body = { id: admin ? 'column-admin' : 'column-client', email: admin ? 'admin@columns.test' : 'client@columns.test', isAdmin: admin, isGlobal: admin, canManageAdmins: admin, canManageUsers: admin, canViewFinancials: true, clientIds: admin ? [] : [4], permissions: ['financials:read'] };
      else if (url.pathname.endsWith('/billing/columns')) {
        if (route.request().method() === 'PUT') {
          if (!admin) return route.fulfill({ status: 403, json: { error: 'Admin required' } });
          state.saved = { ...route.request().postDataJSON(), revision: 'saved-revision' };
          state.saves++;
        }
        body = { ...state.saved, canManage: admin };
      } else if (url.pathname.endsWith('/clients')) body = { data: [{ id: 4, name: 'HUGRAB', active: true }] };
      else if (url.pathname.includes('invoice-summary')) body = {
        billingVisible: true, data: [{ clientId: 4, clientName: 'HUGRAB', periodStart: '2026-09-01', periodEnd: '2026-09-30', orders: 1, pickpackTotal: 2.5, shippingTotal: 20, customsDutiesTotal: 5, rowTotal: 27.5 }],
        totals: { orders: 1, pickpackTotal: 2.5, shippingTotal: 20, customsDutiesTotal: 5, rowTotal: 27.5 },
      };
      else if (url.pathname.includes('invoice-details')) body = { billingVisible: true, data: [{
        canonicalEventId: '0123456789abcdef0123456789abcdef', clientId: 4, clientName: 'HUGRAB', orderId: 4052, orderNumber: '4052', displayReference: '4052', rowType: 'Outbound',
        qty: 1, pickpackTotal: 2.5, shippingTotal: 20, customsDutiesTotal: 5, hasCustomsDutiesLine: true, rowTotal: 27.5, billingEffectiveDate: '2026-09-16',
      }] };
      return route.fulfill({ json: body });
    }
    if (url.origin === base) return route.continue();
    return route.abort();
  });
}

test('admin settings control separate client billing sessions without changing totals', async ({ browser }, testInfo) => {
  const state = { saved: initial(), saves: 0 };
  const admin = await browser.newContext();
  const client = await browser.newContext();
  await setup(admin, true, state);
  await setup(client, false, state);
  const adminPage = await admin.newPage();
  const clientPage = await client.newPage();
  await adminPage.goto(`${base}/settings`);
  await adminPage.getByRole('tab', { name: 'Billing', exact: true }).click();
  const panel = adminPage.getByRole('region', { name: 'Client-visible billing columns' });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('checkbox', { name: /^Billing Period / })).toBeDisabled();
  await panel.getByRole('group', { name: 'Billing summary', exact: true }).getByRole('checkbox', { name: /^Shipping / }).uncheck();
  await panel.getByRole('group', { name: 'Billing line items', exact: true }).getByRole('checkbox', { name: /^Customs\/Duties / }).uncheck();
  await panel.getByRole('button', { name: 'Save client-visible columns' }).click();
  await expect.poll(() => state.saves).toBe(1);
  await expect(panel.getByRole('group', { name: 'Billing summary', exact: true }).getByText('Shipping', { exact: true }).locator('..')).toContainText('Hidden from clients');
  await adminPage.getByRole('tab', { name: 'Billing', exact: true }).scrollIntoViewIfNeeded();
  await adminPage.screenshot({ path: testInfo.outputPath('settings-preview.png') });
  await adminPage.reload();
  await adminPage.getByRole('tab', { name: 'Billing', exact: true }).click();
  await expect(adminPage.getByRole('group', { name: 'Billing summary', exact: true }).getByRole('checkbox', { name: /^Shipping / })).not.toBeChecked();
  await clientPage.goto(`${base}/billing`);
  await expect(clientPage.getByRole('columnheader', { name: /^Shipping\b/ })).toHaveCount(0);
  await expect(clientPage.getByRole('columnheader', { name: /^Customs\/Duties\b/ })).toBeVisible();
  await expect(clientPage.getByRole('button', { name: /^Columns/ })).toHaveCount(0);
  await expect(clientPage.getByRole('table')).toContainText('$27.50');
  await clientPage.getByRole('row').filter({ has: clientPage.getByText('HUGRAB', { exact: true }) }).click();
  await expect(clientPage.getByRole('columnheader', { name: /^Customs\/Duties\b/ })).toHaveCount(0);
  await expect(clientPage.getByRole('columnheader', { name: /^Shipping\b/ })).toBeVisible();
  await expect(clientPage.getByRole('table')).toContainText('$27.50');
  await clientPage.setViewportSize({ width: 390, height: 844 });
  await expect(clientPage.getByText('Customs/Duties', { exact: true })).toHaveCount(0);
  await expect(clientPage.getByText('$27.50', { exact: true }).last()).toBeVisible();
  await clientPage.goto(`${base}/settings`);
  await expect(clientPage.getByRole('tab', { name: 'Billing', exact: true })).toHaveCount(0);
  await admin.close(); await client.close();
});

test('default policy preserves every existing billing column', async ({ browser }) => {
  const state = { saved: initial(), saves: 0 };
  const context = await browser.newContext();
  await setup(context, false, state);
  const page = await context.newPage();
  await page.goto(`${base}/billing`);
  // Summary adds its existing invoice-action and drill-in columns.
  await expect(page.getByRole('columnheader')).toHaveCount(BILLING_COLUMN_SECTIONS.summary.length + 2);
  await expect(page.getByRole('columnheader', { name: /^Addl Units\b/ })).toBeVisible();
  await page.getByRole('row').filter({ has: page.getByText('HUGRAB', { exact: true }) }).click();
  await expect(page.getByRole('columnheader')).toHaveCount(BILLING_COLUMN_SECTIONS.lineItems.length);
  await context.close();
});
