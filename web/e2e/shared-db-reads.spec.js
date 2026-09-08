import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';

for (const width of [1440, 390]) test(`billing data stays readable without animation frames (${width}px)`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const user = { id: 'render-fixture', aud: 'authenticated', role: 'authenticated', email: 'fixture@example.test',
    app_metadata: { role: 'admin', permissions: ['scope:global'] }, user_metadata: {} };
  const token = [part({ alg: 'HS256', typ: 'JWT' }), part({ sub: user.id, exp: 4102444800, ...user }), 'offline'].join('.');
  await page.addInitScript(session => {
    localStorage.setItem('sb-portal-e2e-auth-token', JSON.stringify(session));
    // A busy/paused animation scheduler must not hide successfully returned data.
    window.requestAnimationFrame = () => 1;
    window.cancelAnimationFrame = () => {};
  }, { access_token: token, refresh_token: 'offline', expires_at: 4102444800, expires_in: 2147483647, token_type: 'bearer', user });
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  let summaryStarted = false;
  const reads = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/client-portal/')) return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
    reads.push(url.pathname);
    let data = { data: [], billingVisible: true, pagination: { page: 1, pageSize: 100, total: 0, totalPages: 1 } };
    if (url.pathname.endsWith('/me')) data = { ...user, isAdmin: true, canViewFinancials: true, clientIds: [], storeIds: [], permissions: ['scope:global'] };
    if (url.pathname.endsWith('/clients')) data = { data: [{ id: 1, name: 'Visible fixture client' }] };
    if (url.pathname.endsWith('/invoice-summary')) {
      summaryStarted = true; await ready;
      data = { data: [{ clientId: 1, clientName: 'Visible fixture client', periodStart: '2026-06-01', periodEnd: '2026-06-15',
        orders: 1, pickpackTotal: 2.5, additionalTotal: 0, packageTotal: 0, shippingTotal: 6.1, storageTotal: 0, rowTotal: 8.6 }],
        totals: { orders: 1, pickpackTotal: 2.5, additionalTotal: 0, packageTotal: 0, shippingTotal: 6.1, storageTotal: 0, rowTotal: 8.6 }, billingVisible: true };
    }
    await route.fulfill({ json: data });
  });
  await page.goto('http://127.0.0.1:5177/billing');
  await expect.poll(() => summaryStarted).toBe(true);
  const action = page.getByRole('button', { name: /^View billing details for Visible fixture client/ });
  await expect(action).toHaveCount(0); // Pending data is still a loading state.
  release();
  await expect.poll(() => action.count()).toBe(1); // Only the active responsive representation is accessible.
  const readableAction = await page.evaluate(() => {
    const actions = [...document.querySelectorAll('button')].filter(el => el.getAttribute('aria-label')?.startsWith('View billing details for Visible fixture client'));
    const rendered = actions.filter(el => el.getBoundingClientRect().width > 0);
    return rendered.length === 1 && rendered.every(el => {
      for (let node = el; node; node = node.parentElement) {
        const s = getComputedStyle(node);
        if (Number(s.opacity) !== 1 || s.visibility === 'hidden' || s.display === 'none' || (s.filter !== 'none' && s.filter !== 'blur(0px)')) return false;
      }
      return true;
    });
  });
  expect(readableAction).toBe(true);
  // Dispatch the real accessible action without Playwright's animation-frame stability wait.
  await action.dispatchEvent('click');
  await expect.poll(() => reads.filter(p => p.endsWith('/invoice-details')).length).toBe(1);
  expect(reads.some(p => p.endsWith('/daily-counts'))).toBe(false);
});

test('portal prefetch waits for visibility and reuses the Inventory page request', async ({ page }) => {
  const part = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const user = { id: 'shared-db-user', aud: 'authenticated', role: 'authenticated', email: 'fixture@example.test',
    app_metadata: { role: 'admin', permissions: ['scope:global'] }, user_metadata: {} };
  const token = [part({ alg: 'HS256', typ: 'JWT' }), part({ sub: user.id, exp: 4102444800, ...user }), 'offline'].join('.');
  await page.addInitScript(session => {
    localStorage.setItem('sb-portal-e2e-auth-token', JSON.stringify(session));
    window.fixtureHidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.fixtureHidden });
  }, { access_token: token, refresh_token: 'offline', expires_at: 4102444800, expires_in: 2147483647, token_type: 'bearer', user });
  const requests = [];
  let active = 0, speculativePeak = 0;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/client-portal/')) {
      requests.push(url.pathname);
      const speculative = ['/api/client-portal/dashboard', '/api/client-portal/orders', '/api/client-portal/inventory'].includes(url.pathname);
      if (speculative) { active++; speculativePeak = Math.max(speculativePeak, active); }
      await new Promise(resolve => setTimeout(resolve, 60));
      await route.fulfill({ json: { data: [], billingVisible: true, pagination: { page: 1, pageSize: 100, total: 0, totalPages: 1 } } });
      if (speculative) active--;
    } else if (url.hostname === '127.0.0.1') await route.continue();
    else await route.abort();
  });
  await page.goto('http://127.0.0.1:5177/billing');
  await expect(page.getByRole('link', { name: 'Inventory', exact: true })).toBeVisible();
  await page.waitForTimeout(800);
  expect(requests.filter(p => p.endsWith('/inventory'))).toHaveLength(0);
  expect(requests.filter(p => p.endsWith('/dashboard'))).toHaveLength(0);
  await page.evaluate(() => { window.fixtureHidden = false; document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => requests.filter(p => p.endsWith('/inventory')).length).toBe(1);
  await expect.poll(() => active).toBe(0);
  await page.getByRole('link', { name: 'Inventory', exact: true }).click();
  await expect(page).toHaveURL(/inventory/);
  await page.waitForTimeout(400);
  expect(requests.filter(p => p.endsWith('/inventory'))).toHaveLength(1);
  expect(requests.some(p => p.endsWith('/daily-counts'))).toBe(false);
  expect(speculativePeak).toBe(1);
});

test('read cancellation preserves active consumers and prevents stale-user cache reuse', async ({ page }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  await page.goto('http://127.0.0.1:5177/login');
  const result = await page.evaluate(async () => {
    const { apiGet } = await import('/src/lib/api/transport.ts');
    const { portalQueryKey, portalReadKeys } = await import('/src/lib/query-keys.ts');
    const { QueryClient, QueryObserver } = await import('/node_modules/.vite/deps/@tanstack_react-query.js');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: 1, staleTime: 60000 } } });
    const originalFetch = window.fetch;
    let calls = 0, aborted = 0;
    window.fetch = async (_url, init) => {
      calls++;
      return new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => { aborted++; reject(new DOMException('Aborted', 'AbortError')); });
      });
    };
    const key = portalQueryKey('A', portalReadKeys.inventory(1));
    const options = { queryKey: key, queryFn: ({ signal }) => apiGet({ accessToken: 'A', signal }, '/fixture') };
    const one = new QueryObserver(qc, options), two = new QueryObserver(qc, options);
    const stopOne = one.subscribe(() => {}), stopTwo = two.subscribe(() => {});
    await new Promise(resolve => setTimeout(resolve, 20));
    stopOne(); const afterOne = aborted;
    stopTwo(); await new Promise(resolve => setTimeout(resolve, 50));
    const cancelledCalls = calls, afterBoth = aborted;
    window.fetch = async () => { calls++; return Response.json({ owner: 'A', data: [] }); };
    await qc.prefetchQuery(options);
    await qc.fetchQuery(options);
    const matchingCalls = calls - cancelledCalls;
    const otherUser = qc.getQueryData(portalQueryKey('B', portalReadKeys.inventory(1)));
    const otherPage = qc.getQueryData(portalQueryKey('A', portalReadKeys.inventory(1, '', 1, 50)));
    qc.clear(); window.fetch = originalFetch;
    return { afterOne, afterBoth, cancelledCalls, matchingCalls, otherUser, otherPage };
  });
  expect(result).toEqual({ afterOne: 0, afterBoth: 1, cancelledCalls: 1, matchingCalls: 1, otherUser: undefined, otherPage: undefined });
});

test('read deadline remains active after headers while response body is stalled', async ({ page }) => {
  let started = false, disconnected = false;
  const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Accept');
    if (req.method === 'OPTIONS') { res.end(); return; }
    started = true;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{');
    res.on('close', () => { disconnected = true; });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.goto('http://127.0.0.1:5177/login');
    await page.clock.install();
    await page.evaluate(async port => {
      const { apiGet } = await import('/src/lib/api/transport.ts');
      window.bodyOutcome = 'pending';
      void apiGet('offline', `http://127.0.0.1:${port}/body`).then(() => { window.bodyOutcome = 'success'; }, e => { window.bodyOutcome = e.name; });
    }, server.address().port);
    await expect.poll(() => started).toBe(true);
    await page.clock.fastForward(30001);
    await expect.poll(() => page.evaluate(() => window.bodyOutcome)).toBe('AbortError');
    await expect.poll(() => disconnected).toBe(true);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
