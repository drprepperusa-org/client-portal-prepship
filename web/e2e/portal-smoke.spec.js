import { expect, test } from '@playwright/test';

const baseUrl = 'http://127.0.0.1:5177';

test('client portal dashboard and navigation are client-safe', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('clientPortal.demo', 'true');
  });
  await page.goto(`${baseUrl}/dashboard`);

  await page.locator('aside[aria-label="Client portal navigation"]').hover();
  await expect(page.getByRole('link', { name: 'PrepShip' })).toBeVisible();
  await expect(page.getByText('DR PREPPER')).toBeVisible();
  await expect(page.getByRole('link', { name: /Overview/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Open Orders' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Shipment Tracking Overview' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Connections/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Settings/ })).toHaveCount(0);

  await page.goto(`${baseUrl}/dashboard/orders`);
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Awaiting shipment' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('DP-10491')).toBeVisible();
  await page.getByRole('tab', { name: 'Shipped' }).click();
  await expect(page.getByText('DP-10464')).toBeVisible();
  await page.getByRole('tab', { name: 'Cancelled' }).click();
  await expect(page.getByRole('cell', { name: 'No cancelled orders found' })).toBeVisible();
  await expect(page.getByText('Purchase label')).toHaveCount(0);
  await expect(page.getByText('Batch')).toHaveCount(0);

  await page.goto(`${baseUrl}/dashboard/inventory`);
  await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();
  await expect(page.getByText('DRP-READY-01')).toBeVisible();

  await page.goto(`${baseUrl}/dashboard/invoices`);
  await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible();
  await expect(page.getByText('DrPrepperUSA', { exact: true })).not.toHaveCount(0);
});

test('topbar controls open visible client-safe menus', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('clientPortal.demo', 'true');
  });
  await page.goto(`${baseUrl}/dashboard`);

  await page.getByRole('button', { name: 'Select store scope' }).click();
  await expect(page.getByText('Assigned scope')).toBeVisible();
  await expect(page.getByText('DrPrepperUSA', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Notifications' }).click();
  await expect(page.getByText('Notification center')).toBeVisible();
  await expect(page.getByText('7 active alerts')).toBeVisible();

  await page.getByRole('button', { name: 'Account menu' }).click();
  const accountMenu = page.locator('[aria-label="Account details menu"]');
  await expect(accountMenu.getByText('Demo mode')).toBeVisible();
  await expect(accountMenu.getByRole('button', { name: 'Sign out' })).toBeVisible();
});

test('overview controls produce visible outcomes instead of no-op clicks', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('clientPortal.demo', 'true');
  });
  await page.goto(`${baseUrl}/dashboard`);

  await page.getByRole('button', { name: 'Customize dashboard' }).click();
  await expect(page.getByText('Dashboard preferences')).toBeVisible();
  await page.getByRole('button', { name: 'Close dashboard preferences' }).click();

  await page.getByRole('button', { name: 'New task' }).click();
  await expect(page).toHaveURL(/\/dashboard\/orders/);
  await page.goto(`${baseUrl}/dashboard`);

  await page.getByRole('button', { name: 'Export open orders' }).click();
  await expect(page.getByText('Export ready')).toBeVisible();

  await page.getByRole('tab', { name: /Awaiting Fulfillment/ }).click();
  await expect(page.getByRole('tab', { name: /Awaiting Fulfillment/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Awaiting Shipment')).toBeVisible();
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
