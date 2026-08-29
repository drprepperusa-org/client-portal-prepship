import { expect, test } from '@playwright/test';

const baseUrl = 'http://127.0.0.1:5177';
const storageKey = 'sb-portal-e2e-auth-token';

function recoverySession() {
  const payload = Buffer.from(JSON.stringify({
    aud: 'authenticated',
    exp: 4_102_444_800,
    sub: 'recovery-user',
    email: 'client@example.com',
    role: 'authenticated',
  })).toString('base64url');
  const accessToken = `eyJhbGciOiJIUzI1NiJ9.${payload}.e2e-signature`;
  const user = {
    id: 'recovery-user',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'client@example.com',
    app_metadata: { provider: 'email', providers: ['email'], role: 'client_user', clientIds: [1] },
    user_metadata: {},
    identities: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-07-18T00:00:00.000Z',
  };
  return {
    access_token: accessToken,
    refresh_token: 'recovery-refresh-token',
    expires_in: 2_147_483_647,
    expires_at: 4_102_444_800,
    token_type: 'bearer',
    user,
  };
}

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

test('forgot password requests a production-compatible Supabase recovery link', async ({ page }) => {
  // Supabase mails the recovery link from POST /auth/v1/recover?redirect_to=...
  // ('?' is a literal in Playwright globs, so this pins the query form.) One
  // pattern for both the stub and the wait, so the two can never drift apart.
  const recoverEndpoint = '**/auth/v1/recover?**';
  await page.route(recoverEndpoint, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });

  await page.goto(`${baseUrl}/login`);
  await page.getByRole('button', { name: 'Forgot password?' }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);
  // The URL flips on history.pushState, which lands before React commits the
  // route swap - on a cold dev server that gap is wide enough to matter. Wait
  // for the recovery form itself, or the fill below goes into the outgoing
  // login email field and the email-gated submit button never enables.
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
  await page.getByPlaceholder('you@company.com').fill('client@example.com');

  // Arm the wait before the click: what this test certifies is the recovery
  // request Supabase receives, not how fast the confirmation paints.
  const recoveryRequest = page.waitForRequest(recoverEndpoint);
  await page.getByRole('button', { name: 'Send recovery email' }).click();

  expect((await recoveryRequest).url()).toContain(encodeURIComponent(`${baseUrl}/reset-password`));
  await expect(page.getByText(/password recovery email has been sent/i)).toBeVisible();
});

test('reset-password without a Supabase recovery session fails closed', async ({ page }) => {
  await page.goto(`${baseUrl}/reset-password`);
  await expect(page.getByRole('heading', { name: 'Recovery link required' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send a new recovery email' })).toBeVisible();
});

test('Supabase recovery session updates the password and returns to sign in', async ({ page }) => {
  const session = recoverySession();
  await page.addInitScript(
    ({ key, value }) => {
      localStorage.setItem(key, JSON.stringify(value));
      sessionStorage.setItem('prepship.passwordRecovery', '1');
    },
    { key: storageKey, value: session },
  );
  await page.route('**/auth/v1/user', async (route) => {
    expect(route.request().method()).toBe('PUT');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: session.user }),
    });
  });
  await page.route('**/auth/v1/logout*', async (route) => {
    await route.fulfill({ status: 204, body: '' });
  });

  await page.goto(`${baseUrl}/reset-password`);
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await page.getByRole('textbox', { name: /^New password/ }).fill('NewSecurePassword123!');
  await page.getByRole('textbox', { name: /^Confirm password/ }).fill('NewSecurePassword123!');
  await page.getByRole('button', { name: 'Update password' }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText('Sign in with your new password.')).toBeVisible();
});
