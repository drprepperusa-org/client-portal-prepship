import { expect, test } from '@playwright/test';

const baseUrl = 'http://127.0.0.1:5177';

test('client portal dashboard and navigation are client-safe', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('clientPortal.demo', 'true');
  });
  await page.goto(`${baseUrl}/dashboard`);

  await expect(page.getByText('DR PREPPERUSA')).toBeVisible();
  await expect(page.getByRole('link', { name: /Dashboard/ })).toBeVisible();
  await expect(page.getByText('Open Orders')).toBeVisible();
  await expect(page.getByText('Orders volume')).toBeVisible();
  await expect(page.getByText('Connected Stores')).toBeVisible();
  await expect(page.getByRole('link', { name: /Store Connections/ })).toBeVisible();

  await page.goto(`${baseUrl}/dashboard/orders`);
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Awaiting shipment' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('DP-10491')).toBeVisible();
  await page.getByRole('tab', { name: 'Shipped' }).click();
  await expect(page.getByText('DP-10464')).toBeVisible();
  await page.getByRole('tab', { name: 'Cancelled' }).click();
  await expect(page.getByText('No cancelled orders found')).toBeVisible();
  await expect(page.getByText('Purchase label')).toHaveCount(0);
  await expect(page.getByText('Batch')).toHaveCount(0);

  await page.goto(`${baseUrl}/dashboard/inventory`);
  await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();
  await expect(page.getByText('DRP-READY-01')).toBeVisible();

  await page.goto(`${baseUrl}/dashboard/invoices`);
  await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible();
  await expect(page.getByText('DrPrepperUSA', { exact: true })).toBeVisible();
});

test('store connections wizard supports platform search and setup forms', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('clientPortal.demo', 'true');
  });
  await page.goto(`${baseUrl}/dashboard/connections`);

  await expect(page.getByRole('heading', { name: 'Store Connections' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Walmart Marketplace' })).toBeVisible();

  await page.getByRole('button', { name: /Add store/ }).click();
  await expect(page.getByRole('heading', { name: 'Where do your orders come from?' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Shopify/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /WooCommerce/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Faire/ })).toBeVisible();

  await page.getByPlaceholder('Search 13 supported platforms...').fill('eBay');
  await expect(page.getByRole('button', { name: /eBay/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Shopify/ })).toHaveCount(0);

  await page.getByRole('button', { name: /eBay/ }).click();
  await expect(page.getByRole('heading', { name: 'eBay' })).toBeVisible();
  await expect(page.getByLabel('Seller ID')).toBeVisible();
  await expect(page.getByLabel('Refresh token')).toBeVisible();

  await page.getByLabel('Store name').fill('eBay Outlet');
  await page.getByLabel('Seller ID').fill('drprepper-ebay');
  await page.getByLabel('Client ID').fill('demo-client-id');
  await page.getByLabel('Client secret').fill('demo-client-secret');
  await page.getByLabel('Refresh token').fill('demo-token');
  await page.getByRole('button', { name: 'Review connection' }).click();
  await expect(page.getByRole('heading', { name: 'Save this connection?' })).toBeVisible();
  await page.getByRole('button', { name: /Save connection/ }).click();
  await expect(page.getByText('Store connection added.')).toBeVisible();
  await expect(page.getByText('eBay Outlet')).toBeVisible();
});

test('store connections reconfigure and disconnect flows are available', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('clientPortal.demo', 'true');
  });
  await page.goto(`${baseUrl}/dashboard/connections`);

  await page.getByRole('button', { name: /Reconfigure/ }).first().click();
  await expect(page.getByRole('heading', { name: /Reconfigure Walmart Marketplace/ })).toBeVisible();
  await expect(page.getByLabel('Store name')).toHaveValue('Walmart Marketplace');
  await page.getByLabel('Store name').fill('Walmart Marketplace Main');
  await page.getByRole('button', { name: 'Review connection' }).click();
  await page.getByRole('button', { name: /Save connection/ }).click();
  await expect(page.getByText('Store connection updated.')).toBeVisible();

  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: /Disconnect/ }).first().click();
  await expect(page.getByText('Store connection disconnected.')).toBeVisible();
});

test('demo badge appears when demo mode is explicitly enabled', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('clientPortal.demo', 'true');
  });
  await page.goto(`${baseUrl}/dashboard`);
  await expect(page.getByText('Demo data')).toBeVisible();
});

test('login remains the public entry point without demo mode', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.removeItem('clientPortal.demo');
  });
  await page.goto(`${baseUrl}/dashboard/orders`);
  await expect(page).toHaveURL(/\/login\?redirect=/);
  await expect(page.getByRole('heading', { name: /Sign in|Welcome back|Client portal/ })).toBeVisible();
});
