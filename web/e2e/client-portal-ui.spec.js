import { expect, test } from '@playwright/test';

const baseUrl = 'http://127.0.0.1:5177';
const storageKey = 'sb-portal-e2e-auth-token';
const day = '2026-07-09';

function dashboardMetric(value, periodTotal = value) {
  return {
    value,
    periodTotal,
    dailyAverage: periodTotal,
    periodSharePercent: periodTotal > 0 ? (value / periodTotal) * 100 : 0,
    vsDailyAveragePercent: periodTotal > 0 ? ((value - periodTotal) / periodTotal) * 100 : 0,
    busiestRank: 1,
    periodDayCount: 1,
  };
}

const portalRoutes = [
  ['/', 'Dashboard'],
  ['/orders', 'Orders'],
  ['/inbound', 'Inbound'],
  ['/shipments', 'Shipments'],
  ['/returns', 'Returns'],
  ['/inventory', 'Inventory'],
  ['/analysis', 'Analysis'],
  ['/billing', 'Billing'],
  ['/connections', 'Connections'],
  ['/settings', 'Settings'],
];

function encodeJwtPart(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function e2eToken(admin) {
  return [
    encodeJwtPart({ alg: 'HS256', typ: 'JWT' }),
    encodeJwtPart({
      aud: 'authenticated',
      exp: 4_102_444_800,
      sub: admin ? 'e2e-admin' : 'e2e-client',
      email: admin ? 'admin@portal-e2e.test' : 'client@portal-e2e.test',
      role: 'authenticated',
      app_metadata: admin
        ? { role: 'admin', permissions: ['scope:global'] }
        : { role: 'client_user', clientIds: [1] },
    }),
    'e2e-signature',
  ].join('.');
}

function session(admin) {
  const accessToken = e2eToken(admin);
  const email = admin ? 'admin@portal-e2e.test' : 'client@portal-e2e.test';
  const id = admin ? 'e2e-admin' : 'e2e-client';
  return {
    access_token: accessToken,
    refresh_token: 'e2e-refresh-token',
    expires_in: 2_147_483_647,
    expires_at: 4_102_444_800,
    token_type: 'bearer',
    user: {
      id,
      aud: 'authenticated',
      role: 'authenticated',
      email,
      email_confirmed_at: '2026-01-01T00:00:00.000Z',
      last_sign_in_at: '2026-07-10T00:00:00.000Z',
      app_metadata: admin
        ? { provider: 'email', providers: ['email'], role: 'admin', permissions: ['scope:global'] }
        : { provider: 'email', providers: ['email'], role: 'client_user', clientIds: [1] },
      user_metadata: {},
      identities: [],
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-07-10T00:00:00.000Z',
    },
  };
}

const returnRow = {
  id: 1,
  orderId: 101,
  orderNumber: 'E2E-101',
  returnReference: 'E2E-RET-1',
  clientId: 1,
  clientName: 'E2E Client',
  status: 'label_created',
  initiatedBy: 'client',
  reason: 'Fixture return',
  deliveryMethod: 'manual_pdf',
  deliveryStatus: 'pending',
  trackingNumber: '1ZE2E000000000001',
  trackingUrl: null,
  pdfAvailable: false,
  returnCustomerShippingRate: 8.25,
  createdAt: '2026-07-09T12:00:00.000Z',
};

const orderRow = {
  id: 101,
  clientId: 1,
  clientName: 'Walmart - DJC',
  storeId: 1,
  storeName: 'Walmart',
  orderNumber: '200014902407643',
  externalOrderId: 'E2E-ORDER-101',
  sourceProvider: 'walmart',
  sourceStoreId: 'e2e-store',
  orderStatus: 'shipped',
  fulfillmentStatus: 'in_transit',
  orderDate: '2026-07-16T11:59:00.000Z',
  shipToName: 'E2E Customer',
  shipToLine1: null,
  shipToLine2: null,
  shipToCity: null,
  shipToState: null,
  shipToPostalCode: null,
  shipToCountry: null,
  displayTrackingNumber: null,
  trackingUrl: null,
  items: [{
    sku: 'SOON VEGGIE 4P',
    name: 'Nongshim Soon Veggie Soup',
    quantity: 1,
    imageUrl: null,
  }],
  orderedUnits: 1,
  weightOz: 16,
  orderTotal: '14.99',
  customerShippingRate: '5.00',
  customerShippingRatePending: false,
};

const emptyPagination = { page: 1, pageSize: 50, total: 0, totalPages: 1 };
const invoiceTotals = {
  orders: 0,
  pickpackTotal: 0,
  additionalTotal: 0,
  packageTotal: 0,
  storageTotal: 0,
  shippingTotal: 0,
  returnPostageTotal: 0,
  returnProcessingTotal: 0,
  rowTotal: 0,
};

function responseFor(pathname, admin, capabilities = {}, returnOverrides = {}) {
  if (pathname === '/api/client-portal/me') {
    return {
      id: admin ? 'e2e-admin' : 'e2e-client',
      email: admin ? 'admin@portal-e2e.test' : 'client@portal-e2e.test',
      role: admin ? 'admin' : 'client_user',
      isAdmin: admin,
      isGlobal: admin,
      isRestricted: !admin,
      clientIds: admin ? [] : [1],
      storeIds: [],
      canViewFinancials: true,
      canManageUsers: capabilities.canManageUsers ?? admin,
      canManageAdmins: capabilities.canManageAdmins ?? admin,
      canViewAudit: capabilities.canViewAudit ?? admin,
    };
  }
  if (pathname === '/api/client-portal/clients') {
    return { data: [{ id: 1, name: 'E2E Client' }] };
  }
  if (pathname === '/api/client-portal/sync-status') {
    return { status: 'ok', lastSyncAt: '2026-07-10T00:00:00.000Z' };
  }
  if (pathname === '/api/client-portal/dashboard') {
    return {
      revenue: 25,
      units: 3,
      openOrderCount: 1,
      period: {
        dayCount: 1,
        orderedOrderCount: 2,
        orderedUnitCount: 3,
        allOrderCount: 2,
        awaitingOrderCount: 1,
        shippedOrderCount: 1,
        cancelledOrderCount: 0,
        shipmentCount: 1,
        averageShippedOrdersPerDay: 1,
        peakShippedOrderCount: 1,
      },
      bySku: [{
        sku: 'E2E-SKU',
        name: 'E2E product',
        units30: 3,
        revenue: 25,
        avgShippingPrice: 4,
      }],
      daily: [{
        day,
        orderedOrders: dashboardMetric(2),
        orderedUnits: dashboardMetric(3),
        allOrders: dashboardMetric(2),
        awaitingOrders: dashboardMetric(1),
        shippedOrders: dashboardMetric(1),
        cancelledOrders: dashboardMetric(0, 0),
        shipmentsCreated: dashboardMetric(1),
        unitsPerOrder: 1.5,
      }],
    };
  }
  if (pathname === '/api/client-portal/daily-counts') {
    return { data: [{ day, awaiting: 1, shipped: 1, cancelled: 0, total: 2 }] };
  }
  if (pathname === '/api/client-portal/daily-shipments') {
    return { data: [{ day, shipments: 1 }] };
  }
  if (pathname === '/api/client-portal/orders/awaiting-active-count') return { count: 1 };
  if (pathname === '/api/client-portal/analysis') {
    return {
      data: [{
        sku: 'E2E-SKU',
        name: 'E2E product',
        image_url: null,
        inv_sku_id: 501,
        client_id: 1,
        client_name: 'E2E Client',
        orders: 1,
        pending: 0,
        total_qty: 3,
        total_revenue: '25.00',
        daily_qty: [3],
      }],
      dateBuckets: [day],
      orderCombinations: [],
      totalSkus: 1,
      totalOrders: 1,
      totalUnits: 3,
      totalRevenue: 25,
    };
  }
  if (pathname === '/api/client-portal/analysis/sku-orders') {
    return {
      sku: 'E2E-SKU',
      name: 'E2E product',
      totalUnits: 3,
      avgShippingCharge: '4.00',
      averageUnitsPerDay: 1.5,
      dailySales: [{ day, units: 3 }],
      orders: [{
        order_id: 501,
        order_number: 'E2E-501',
        order_date: '2026-07-09T12:00:00.000Z',
        order_status: 'shipped',
        ship_to_name: 'Pat Customer',
        qty: 3,
        unit_price: '8.33',
        item_name: 'E2E product',
        shippingCharge: '4.00',
      }],
    };
  }
  if (pathname === '/api/client-portal/returns/1') {
    return {
      data: {
        ...returnRow,
        trackingStatus: 'In transit',
        deliveryError: null,
        returnToLocationId: null,
        pdfUrl: null,
        requestedAt: '2026-07-09T12:00:00.000Z',
        closedAt: null,
        items: [{ id: 1, sku: 'E2E-SKU', name: 'E2E product', quantity: 1, orderItemId: 10 }],
        inspections: [{
          id: 4,
          status: 'passed',
          condition: 'opened_good',
          comments: 'Contents checked and complete.',
          receivedAt: '2026-07-10T14:30:00.000Z',
          actorLabel: 'PrepShip',
          createdAt: '2026-07-10T14:30:00.000Z',
          updatedAt: '2026-07-10T14:30:00.000Z',
          media: [{
            id: 8,
            mediaType: 'photo',
            url: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
            contentType: 'image/gif',
            fileName: 'received-item.gif',
            sizeBytes: 43,
            capturedAt: '2026-07-10T14:29:00.000Z',
            uploadedAt: '2026-07-10T14:31:00.000Z',
          }],
        }],
        activity: [{ id: 1, eventType: 'return_requested', status: 'requested', detail: null, actorLabel: 'Client', eventAt: '2026-07-09T12:00:00.000Z' }],
        orderActivity: [{ id: -1, eventType: 'original_order_placed', status: 'placed', detail: null, actorLabel: 'System', eventAt: '2026-07-01T12:00:00.000Z' }],
        ...returnOverrides,
      },
    };
  }
  if (pathname === '/api/client-portal/returns') {
    return {
      data: [{ ...returnRow, ...returnOverrides }],
      pagination: { ...emptyPagination, total: 1 },
    };
  }
  if (pathname === '/api/client-portal/invoice-summary') {
    return { data: [], totals: invoiceTotals, billingVisible: true };
  }
  if (pathname === '/api/client-portal/invoice-details') {
    return { data: [], pagination: emptyPagination, billingVisible: true };
  }
  if (pathname === '/api/client-portal/billing/status') return { lastGenerated: null };
  if (pathname === '/api/client-portal/inbound/receipts') {
    return {
      data: [{
        id: 8047,
        inventoryId: 1032,
        clientId: 4,
        clientName: 'HUGRAB',
        sku: 'Booster-gel-001',
        name: 'Booster Gel',
        receivedUnits: 1980,
        receivedAt: '2026-07-13T19:00:00.000Z',
        note: 'MB/L No. 180-20829804',
      }],
      pagination: { ...emptyPagination, total: 1 },
    };
  }
  if (pathname === '/api/client-portal/inbound') return { data: [] };
  if (pathname === '/api/client-portal/integrations') return { data: [] };
  if (pathname === '/api/client-portal/access-list') return { data: [] };
  if (pathname === '/api/client-portal/audit-log') return { data: [] };
  if (pathname === '/api/client-portal/inventory-history') {
    return { data: [], pagination: emptyPagination };
  }
  if (pathname === '/api/client-portal/orders') {
    return { data: [orderRow], pagination: { ...emptyPagination, total: 1 } };
  }
  if (
    pathname === '/api/client-portal/shipments'
    || pathname === '/api/client-portal/inventory'
  ) {
    return { data: [], pagination: emptyPagination };
  }
  return { data: [], pagination: emptyPagination };
}

async function setupPortal(page, { admin = true, capabilities = {}, returnOverrides = {} } = {}) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });

  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    { key: storageKey, value: session(admin) },
  );
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/client-portal/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(responseFor(url.pathname, admin, capabilities, returnOverrides)),
      });
      return;
    }
    if (url.origin === baseUrl) {
      await route.continue();
      return;
    }
    await route.abort('blockedbyclient');
  });
  return errors;
}

for (const viewport of [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
]) {
  test(`active portal routes render without horizontal overflow at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = await setupPortal(page);

    for (const [route, title] of portalRoutes) {
      await page.goto(`${baseUrl}${route}`);
      await expect(page).toHaveURL(new RegExp(`${route === '/' ? '/$' : `${route}$`}`));
      await page.waitForTimeout(100);
      expect(errors, errors.join('\n')).toEqual([]);
      await expect(page.getByRole('heading', { name: title, exact: true, level: 1 })).toBeVisible();
      await expect(page.getByRole('main')).toBeVisible();
      await expect.poll(() => page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      ), `${route} must not create document-level horizontal overflow`).toBe(true);
      await expect(page.locator('.vite-error-overlay')).toHaveCount(0);
    }

    expect(errors, errors.join('\n')).toEqual([]);
  });
}

test('Inbound renders PrepShip receipt truth without synthetic batching', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await setupPortal(page);
  await page.goto(`${baseUrl}/inbound`);

  await expect(page.getByText('Received inventory', { exact: true })).toBeVisible();
  const receiptTable = page.getByRole('table');
  await expect(receiptTable.getByText('Booster-gel-001', { exact: true })).toBeVisible();
  await expect(receiptTable.getByText('Booster Gel', { exact: true })).toBeVisible();
  await expect(receiptTable.getByText('1,980', { exact: true })).toBeVisible();
  await expect(receiptTable.getByText('MB/L No. 180-20829804', { exact: true })).toBeVisible();
  await expect(page.getByText('Expected shipments', { exact: true })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('skip link and mobile navigation are keyboard-safe', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const errors = await setupPortal(page);
  await page.goto(`${baseUrl}/`);

  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();

  const menuButton = page.getByRole('button', { name: 'Open menu' });
  await menuButton.focus();
  await menuButton.click();
  const navigation = page.getByRole('dialog', { name: 'Navigation' });
  await expect(navigation).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  await page.keyboard.press('Escape');
  await expect(page.locator('[role="dialog"][aria-label="Navigation"]'))
    .toHaveAttribute('aria-hidden', 'true');
  await expect(menuButton).toBeFocused();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('modal and drawer trap focus, close with Escape, and restore focus', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await setupPortal(page);

  await page.goto(`${baseUrl}/inbound`);
  const openModal = page.getByRole('button', { name: 'New inbound' });
  await openModal.focus();
  await openModal.click();
  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible();
  await expect(modal).toHaveAttribute('aria-labelledby', /.+/);
  await expect(page.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => modal.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
  await expect(openModal).toBeFocused();

  await page.goto(`${baseUrl}/returns`);
  const returnAction = page.getByRole('button', { name: 'View return E2E-RET-1' });
  await returnAction.focus();
  await returnAction.click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toHaveAccessibleName('E2E-RET-1');
  await expect(page.getByRole('button', { name: 'Close panel' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(returnAction).toBeFocused();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('tables expose keyboard sorting, row actions, and column movement', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await setupPortal(page);
  await page.goto(`${baseUrl}/returns`);

  const sortButton = page.getByRole('button', { name: 'Return ref', exact: true });
  await sortButton.focus();
  await page.keyboard.press('Enter');
  await expect(sortButton.locator('xpath=ancestor::th')).toHaveAttribute('aria-sort', 'ascending');

  await page.getByRole('button', { name: /^Columns/ }).click();
  const moveOrderLeft = page.getByRole('button', { name: 'Move Order left' });
  await moveOrderLeft.focus();
  await page.keyboard.press('Enter');
  await expect(moveOrderLeft).toBeDisabled();
  await expect(page.getByRole('button', { name: 'View return E2E-RET-1' })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('return side panel keeps inspection attachments and order history accessible on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const errors = await setupPortal(page);
  await page.goto(`${baseUrl}/returns`);
  await page.getByRole('button', { name: 'View return E2E-RET-1' }).click();

  const drawer = page.getByRole('dialog');
  const inspectionTab = drawer.getByRole('tab', { name: 'Inspection' });
  await inspectionTab.click();
  await expect(drawer.getByText('Contents checked and complete.')).toBeVisible();
  await expect(drawer.getByRole('img', { name: 'received-item.gif' })).toBeVisible();

  await inspectionTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(drawer.getByRole('tab', { name: 'History' })).toHaveAttribute('aria-selected', 'true');
  await expect(drawer.getByText('Original order placed')).toBeVisible();
  await expect.poll(() => page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  )).toBe(true);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('charts expose summaries, data tables, day selection, and reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = await setupPortal(page);
  await page.goto(`${baseUrl}/`);

  const chart = page.getByRole('figure', { name: 'Orders count and unit count by day' });
  await expect(chart).toBeVisible();
  const details = chart.locator('details');
  const dataToggle = details.locator('summary');
  await dataToggle.focus();
  await expect(dataToggle).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Enter');
  await expect(details).toHaveAttribute('open', '');
  await expect(details.locator('table')).toBeVisible();
  await expect(details.locator('caption')).toHaveText('Orders count and unit count by day');

  await chart.getByLabel('View day details').selectOption(day);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('mobile order card has no blank action row and keeps the date beside its label', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const errors = await setupPortal(page);
  await page.goto(`${baseUrl}/orders?tab=shipped`);

  const action = page.getByRole('button', { name: 'View order 200014902407643' });
  await expect(action).toBeVisible();
  const card = action.locator('xpath=..');
  const dateLabel = card.getByText('Order Date', { exact: true });
  const dateValue = card.getByText('07/16/26', { exact: true });
  const [cardBox, actionBox, labelBox, dateBox] = await Promise.all([
    card.boundingBox(),
    action.boundingBox(),
    dateLabel.boundingBox(),
    dateValue.boundingBox(),
  ]);

  expect(cardBox).not.toBeNull();
  expect(actionBox).not.toBeNull();
  expect(labelBox).not.toBeNull();
  expect(dateBox).not.toBeNull();
  expect(actionBox.y - cardBox.y).toBeLessThan(16);
  expect(labelBox.y - cardBox.y).toBeLessThan(40);
  expect(dateBox.x).toBeLessThan(cardBox.x + cardBox.width / 2);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('failed return label exposes safe recovery copy and retry action', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await setupPortal(page, {
    returnOverrides: {
      status: 'label_failed',
      deliveryError: 'No return rates were returned for this shipment',
    },
  });
  await page.goto(`${baseUrl}/returns`);
  await expect(page.getByRole('table').getByText('Needs retry')).toBeVisible();
  await page.getByRole('button', { name: 'View return E2E-RET-1' }).click();

  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText('Label needs attention.')).toBeVisible();
  await expect(drawer.getByText('No return rates were returned for this shipment')).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Retry return label' })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('Analysis SKU drawer renders the customer-safe DTO', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await setupPortal(page);
  await page.goto(`${baseUrl}/analysis`);

  await page.getByRole('button', { name: 'View SKU details for E2E-SKU' }).click();
  const drawer = page.getByRole('dialog', { name: 'E2E product' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('E2E-SKU', { exact: true })).toBeVisible();
  await expect(drawer.getByText('Recent orders (1)')).toBeVisible();
  await expect(drawer.getByRole('button', { name: /E2E-501/ })).toBeVisible();
  await expect(drawer.getByText('1.5', { exact: true })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('client users remain denied from admin settings', async ({ page }) => {
  await setupPortal(page, { admin: false });
  await page.goto(`${baseUrl}/settings`);
  await expect(page).toHaveURL(`${baseUrl}/`);
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
});

test('scoped user managers see client access controls without admin escalation options', async ({ page }) => {
  await setupPortal(page, {
    admin: false,
    capabilities: { canManageUsers: true, canManageAdmins: false, canViewAudit: false },
  });
  await page.goto(`${baseUrl}/settings`);
  await expect(page).toHaveURL(`${baseUrl}/settings`);
  await expect(page.getByText('Account access')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Profile' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Invite User' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('Admin - global access')).toHaveCount(0);
});
