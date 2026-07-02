import { expect, test } from '@playwright/test';

const baseUrl = 'http://127.0.0.1:5177';

// Browser smoke for the ACTIVE client portal (portal-client/, served by the
// playwright webServer on 5177). The portal has no demo mode, so a browser
// can certify the signed-out surface without live Supabase credentials: the
// auth wall, route redirects, and the login UX. Authenticated page behavior
// is certified by the static guard suite (test:client-portal-*).

const protectedRoutes = [
  '/',
  '/orders',
  '/inbound',
  '/shipments',
  '/inventory',
  '/analysis',
  '/finance',
  '/billing',
  '/rates',
  '/connections',
  '/settings',
];

test('login is the public entry point for signed-out visitors', async ({ page }) => {
  await page.goto(`${baseUrl}/orders`);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByText('Sign in to your fulfillment portal')).toBeVisible();
});

test('every portal route is behind the auth wall when signed out', async ({ page }) => {
  for (const route of protectedRoutes) {
    await page.goto(`${baseUrl}${route}`);
    await expect(page, `${route} must redirect signed-out visitors to /login`).toHaveURL(/\/login$/);
  }
});

test('legacy report/invoice paths and unknown paths stay behind the auth wall', async ({ page }) => {
  // /reports and /invoices are authed redirects into /billing; signed out they
  // must hit the login wall, never render. Unknown paths fall through the
  // catch-all to the app entry, which is also behind the wall.
  for (const route of ['/reports', '/invoices', '/definitely-not-a-page']) {
    await page.goto(`${baseUrl}${route}`);
    await expect(page, `${route} must end at /login when signed out`).toHaveURL(/\/login$/);
  }
});

test('login form exposes sign-in affordances and no self-signup', async ({ page }) => {
  await page.goto(`${baseUrl}/login`);
  await expect(page.getByPlaceholder('you@company.com')).toBeVisible();
  await expect(page.getByPlaceholder('••••••••')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  await expect(page.getByText('Remember me')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Forgot password?' })).toBeVisible();
  // Accounts are provisioned by the operator — the portal must never grow a
  // self-signup path.
  await expect(page.getByText(/create one|sign up/i)).toHaveCount(0);
  await expect(page.getByText('Contact your account manager')).toBeVisible();
  await expect(page.getByText('Secure client access')).toBeVisible();
});
