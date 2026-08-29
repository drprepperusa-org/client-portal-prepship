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
  returnedSkus: ['E2E-SKU'],
  returnedQuantity: 1,
  recipientName: 'E2E Customer',
  returnRecipientName: 'E2E Client',
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
  // CP-061: backend-derived badge fields — the UI renders these verbatim.
  hasActiveReplacement: true,
  activeReplacementStatus: 'requested',
  activeReplacementCount: 1,
  activeReplacementReference: '200014902407643-REPLACE',
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

function responseFor(pathname, admin, capabilities = {}, returnOverrides = {}, integrationRows = [], accessRows = []) {
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
      canRequestReplacements: capabilities.canRequestReplacements ?? admin,
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
      avgShippingStandard: '4.00',
      avgShippingExpedited: '18.00',
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
        // CP-060: mixed-class order — total plus per-class split.
        shippingTotal: '22.00',
        shippingStandard: '4.00',
        shippingExpedited: '18.00',
        shippingMoneyState: 'attributed',
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
  if (pathname === '/api/client-portal/integrations') return { data: integrationRows };
  if (pathname === '/api/client-portal/access-list') return { data: accessRows };
  if (pathname === '/api/client-portal/audit-log') return { data: [] };
  if (pathname === '/api/client-portal/inventory-history') {
    return { data: [], pagination: emptyPagination };
  }
  if (pathname === '/api/client-portal/replacements/reason-contract') {
    return {
      data: {
        version: 'replacement-request-v1',
        reasons: [
          { code: 'damaged', label: 'Damaged' },
          { code: 'wrong_item', label: 'Wrong item' },
          { code: 'lost_in_transit', label: 'Lost in transit' },
          { code: 'other', label: 'Other' },
        ],
      },
    };
  }
  if (pathname === '/api/client-portal/replacements') {
    return {
      data: [{
        id: 7,
        reference: '200014902407643-REPLACE',
        orderId: 101,
        orderNumber: '200014902407643',
        clientId: 1,
        clientName: 'Walmart - DJC',
        status: 'requested',
        reasonCode: 'damaged',
        itemCount: 1,
        requestedAt: '2026-07-16T12:30:00.000Z',
      }],
    };
  }
  if (pathname === '/api/client-portal/replacements/7') {
    return {
      data: {
        id: 7,
        reference: '200014902407643-REPLACE',
        orderId: 101,
        orderNumber: '200014902407643',
        clientId: 1,
        clientName: 'Walmart - DJC',
        status: 'requested',
        reasonCode: 'damaged',
        itemCount: 1,
        requestedAt: '2026-07-16T12:30:00.000Z',
        items: [{ id: 1, sku: 'E2E-SKU', name: 'E2E product', quantity: 1 }],
      },
    };
  }
  if (pathname === '/api/client-portal/orders/101') {
    return { data: { ...orderRow, items: [], chargeSummary: [] } };
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

async function setupPortal(page, {
  admin = true,
  capabilities = {},
  returnOverrides = {},
  integrationRows = [],
  accessRows = [],
} = {}) {
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
        body: JSON.stringify(responseFor(url.pathname, admin, capabilities, returnOverrides, integrationRows, accessRows)),
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
  // CP-060: total renders, and the mixed-class order shows its std/exp split.
  await expect(drawer.getByText('$22.00')).toBeVisible();
  await expect(drawer.getByText(/std \$4\.00 · exp \$18\.00/)).toBeVisible();
  await expect(drawer.getByText('Avg std shipping')).toBeVisible();
  await expect(drawer.getByText('Avg expedited')).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('client users remain denied from admin settings', async ({ page }) => {
  await setupPortal(page, { admin: false });
  await page.goto(`${baseUrl}/settings`);
  await expect(page).toHaveURL(`${baseUrl}/`);
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
});

test('CP-061: REPLACE badge renders from the backend flag on row and detail', async ({ page }) => {
  const errors = await setupPortal(page);
  await page.goto(`${baseUrl}/orders`);
  // Row badge — backend-derived hasActiveReplacement only.
  await expect(page.getByText('REPLACE', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: /View order 200014902407643/ }).click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText('REPLACE', { exact: true })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('CP-061: /replace lists canonical rows and opens the detail drawer', async ({ page }) => {
  const errors = await setupPortal(page);
  await page.goto(`${baseUrl}/replace`);
  await expect(page.getByText('200014902407643-REPLACE')).toBeVisible();
  await expect(page.getByText('1 item', { exact: true })).toBeVisible();
  // CP-061 reason: the list shows the customer-safe LABEL from the PS-502 contract
  // (reasonCode 'damaged' -> 'Damaged'), never the raw code.
  await expect(page.getByText('Damaged').first()).toBeVisible();
  await page.getByText('200014902407643-REPLACE').click();
  const drawer = page.getByRole('dialog', { name: '200014902407643-REPLACE' });
  await expect(drawer).toBeVisible();
  // The reason renders as the contract label; the raw code 'damaged' never appears.
  await expect(drawer.getByText('Damaged', { exact: true })).toBeVisible();
  await expect(drawer.getByText('damaged', { exact: true })).toHaveCount(0);
  await expect(drawer.getByText('E2E-SKU')).toBeVisible();
  // Staff (admin) sees the capability-gated create action.
  await expect(page.getByRole('button', { name: 'Request replacement' })).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('CP-061: client_user sees no create action on /replace', async ({ page }) => {
  await setupPortal(page, { admin: false });
  await page.goto(`${baseUrl}/replace`);
  await expect(page.getByText('200014902407643-REPLACE')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request replacement' })).toHaveCount(0);
});

test('CP-061 reason: a redacted (null) reason shows "Reason unavailable", never raw', async ({ page }) => {
  const errors = await setupPortal(page);
  // A redacted reasonCode (the backend nulled a raw/legacy value). Neither the code nor a seeded
  // raw string may reach the DOM — the UI shows only the neutral "Reason unavailable".
  const nulled = {
    id: 7,
    reference: '200014902407643-REPLACE',
    orderId: 101,
    orderNumber: '200014902407643',
    clientId: 1,
    clientName: 'Walmart - DJC',
    status: 'requested',
    reasonCode: null,
    itemCount: 1,
    requestedAt: '2026-07-16T12:30:00.000Z',
  };
  await page.route('**/api/client-portal/replacements', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [nulled] }) });
  });
  await page.route('**/api/client-portal/replacements/7', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { ...nulled, items: [{ id: 1, sku: 'E2E-SKU', name: 'E2E product', quantity: 1 }] } }),
    });
  });
  await page.goto(`${baseUrl}/replace`);
  await page.getByText('200014902407643-REPLACE').click();
  const drawer = page.getByRole('dialog', { name: '200014902407643-REPLACE' });
  await expect(drawer.getByText('Reason unavailable')).toBeVisible();
  await expect(page.getByText('Customer says box smelled odd')).toHaveCount(0);
  await expect(page.getByText('damaged', { exact: true })).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('CP-061 reason: the create form submits the canonical code, not the label', async ({ page }) => {
  const errors = await setupPortal(page);
  let createBody = null;
  await page.route('**/api/client-portal/replacements', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    createBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id: 8 } }) });
  });
  await page.goto(`${baseUrl}/replace`);
  await page.getByRole('button', { name: 'Request replacement' }).click();
  const modal = page.getByRole('dialog', { name: 'Request replacement' });
  await expect(modal).toBeVisible();
  // The reason is a select of contract LABELS whose values are canonical codes.
  await expect(modal.getByRole('option', { name: 'Lost in transit' })).toBeAttached();
  await modal.getByPlaceholder('e.g. 1321').fill('1321');
  await modal.locator('select').selectOption('lost_in_transit');
  await modal.getByLabel('SKU').fill('SKU-1');
  await modal.getByLabel('Qty').fill('1');
  await modal.getByRole('button', { name: 'Request replacement' }).click();
  await expect.poll(() => (createBody ? createBody.reason : null)).toBe('lost_in_transit');
  expect(createBody.reason).not.toBe('Lost in transit');
  expect(errors, errors.join('\n')).toEqual([]);
});

test('CP-061 reason: an unavailable contract disables the request with safe copy', async ({ page }) => {
  await setupPortal(page);
  // Upstream refusal (feature off) passes through as a non-200 — no options, no fallback labels.
  await page.route('**/api/client-portal/replacements/reason-contract', async (route) => {
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'The replacements surface is not enabled', code: 'REPLACEMENTS_DISABLED' }),
    });
  });
  await page.goto(`${baseUrl}/replace`);
  await page.getByRole('button', { name: 'Request replacement' }).click();
  const modal = page.getByRole('dialog', { name: 'Request replacement' });
  await expect(modal).toBeVisible();
  // Safe explanatory copy, no reason <select>, submit disabled, and no label leaks as an option.
  await expect(modal.getByText(/not available right now/i)).toBeVisible();
  await expect(modal.locator('select')).toHaveCount(0);
  await expect(modal.getByRole('button', { name: 'Request replacement' })).toBeDisabled();
  await expect(modal.getByText('Lost in transit')).toHaveCount(0);
});

test('client can rename a Shopify connection without changing provider identity', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const integrationRows = [{
    id: 7,
    clientId: 1,
    provider: 'shopify',
    label: 'Shopify',
    displayAccountIdentifier: 'sh••••••••om',
    connectionStatus: 'active',
    reconnectReasonCode: null,
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
    type: 'store',
    assignedClientIds: [],
    clientName: 'Chris',
    storeName: null,
    storeIds: [],
    lastSyncedAt: null,
  }];
  const errors = await setupPortal(page, { admin: false, integrationRows });
  let renameBody;
  await page.route('**/api/client-portal/integrations/7/label', async (route) => {
    renameBody = route.request().postDataJSON();
    integrationRows[0].label = renameBody.label;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: integrationRows[0] }),
    });
  });

  await page.goto(`${baseUrl}/connections`);
  await page.getByRole('button', { name: 'Rename Shopify' }).click();
  const dialog = page.getByRole('dialog', { name: 'Rename store connection' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: /Store display name/ }).fill('Chris Shopify Store');
  await dialog.getByRole('button', { name: 'Save name' }).click();

  await expect.poll(() => renameBody).toEqual({ label: 'Chris Shopify Store' });
  await expect(page.getByText('Chris Shopify Store', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Store · shopify/i).first()).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
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

test('settings access presents a focused master-detail roster', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const adminStore = { id: 1, name: 'Admin Store', email: null, active: true, storeIds: [] };
  const clientStore = { id: 2, name: 'Client Store', email: null, active: true, storeIds: [] };
  const additionalStores = Array.from({ length: 10 }, (_, index) => ({
    id: index + 3,
    name: `Store ${index + 3}`,
    email: null,
    active: index % 4 !== 0,
    storeIds: [],
  }));
  const accessRows = [
    {
      id: 'e2e-admin',
      email: 'admin@portal-e2e.test',
      name: 'Portal Admin',
      role: 'admin',
      permissions: ['scope:global'],
      isAdmin: true,
      isGlobal: true,
      isProtected: true,
      active: true,
      clientIds: [1, 2, ...additionalStores.map((store) => store.id)],
      storeIds: [],
      clients: [adminStore, clientStore, ...additionalStores],
      createdAt: '2026-01-01T00:00:00.000Z',
      lastSignInAt: '2026-07-10T00:00:00.000Z',
    },
    {
      id: 'e2e-client-2',
      email: 'client.manager@portal-e2e.test',
      name: 'Client Manager',
      role: 'client_user',
      permissions: [],
      isAdmin: false,
      isGlobal: false,
      isProtected: false,
      active: true,
      clientIds: [2],
      storeIds: [],
      clients: [clientStore],
      createdAt: '2026-02-01T00:00:00.000Z',
      lastSignInAt: null,
    },
  ];
  const errors = await setupPortal(page, { accessRows });

  await page.goto(`${baseUrl}/settings`);
  await page.getByRole('tab', { name: 'Access' }).click();

  const accounts = page.getByRole('region', { name: 'Login accounts' });
  const details = page.getByRole('region', { name: 'Selected login details' });
  await expect(accounts.getByRole('button', { name: 'View access for admin@portal-e2e.test' })).toBeVisible();
  await expect(accounts.getByText('All stores', { exact: true })).toBeVisible();
  await expect(accounts.getByText('Client Store', { exact: true })).toBeVisible();
  await expect(details.getByText('Admin Store', { exact: true })).toBeVisible();
  await expect(details.getByText('Client Store', { exact: true })).toBeVisible();

  await accounts.getByRole('button', { name: 'View access for client.manager@portal-e2e.test' }).click();
  await expect(details.getByText('client.manager@portal-e2e.test', { exact: true })).toBeVisible();
  await expect(details.getByText('Client Store', { exact: true })).toBeVisible();
  await expect(details.getByText('Admin Store', { exact: true })).toHaveCount(0);
  await expect(details.getByRole('button', { name: 'Edit' })).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('region', { name: 'Selected login details' })).toBeVisible();
  const hasMobileHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasMobileHorizontalOverflow).toBe(false);
  expect(errors, errors.join('\n')).toEqual([]);
});

// ── CP-058 AC-8 — browser evidence for the return flows ──────────────────────
//
// Every CP-058 guard so far is static: it reads source and asserts what the code says.
// These render the actual UI, because the defect this card already produced was a
// backend route with no button — source-level checks passed while an operator had no
// way to reach the feature.

test('CP-058 AC-1/AC-2: a label-pending return reads as a deliberate state', async ({ page }) => {
  const errors = await setupPortal(page, { returnOverrides: { status: 'requested' } });
  await page.goto(`${baseUrl}/returns`);

  // "Requested" invited "requested from whom?". The return exists and is waiting on a
  // label, which is what the operator actually needs to know.
  //
  // Scoped to the ROW on purpose. A page-wide text match also resolves the hidden
  // <option> in the status filter, so it would pass even if no row ever rendered the
  // label — it would be proving the dropdown exists, not the status.
  const row = page.getByRole('row').filter({ hasText: 'E2E-RET-1' });
  await expect(row.getByText('Return Started — Label Pending')).toBeVisible();
  expect(errors, errors.join('\n')).toEqual([]);
});

test('CP-058 AC-3/AC-4: the external-tracking surface is reachable and asks for no provider', async ({ page }) => {
  const errors = await setupPortal(page, { returnOverrides: { status: 'requested' } });
  await page.goto(`${baseUrl}/returns`);
  await page.getByRole('button', { name: 'View return E2E-RET-1' }).click();
  const drawer = page.getByRole('dialog');

  await expect(drawer.getByText('Assign external tracking')).toBeVisible();
  await expect(drawer.getByPlaceholder('Tracking number')).toBeVisible();
  await expect(drawer.getByPlaceholder('Amount paid')).toBeVisible();

  // Carrier/service/provider are server-internal. A field for any of them would make the
  // portal a second owner of label identity — the exact rule the route enforces.
  const panel = await drawer.innerText();
  for (const forbidden of ['Carrier', 'Service', 'Provider']) {
    expect(panel.includes(`${forbidden} account`), `${forbidden} must not be collected`).toBe(false);
  }
  expect(errors, errors.join('\n')).toEqual([]);
});

test('CP-058 AC-4: a private external-label PDF uses the backend signed URL', async ({ page }) => {
  const signedPdfUrl = 'https://signed.example.test/cp058-return-label.pdf?token=e2e';
  const errors = await setupPortal(page, {
    returnOverrides: {
      status: 'label_created',
      pdfAvailable: true,
      pdfUrl: signedPdfUrl,
    },
  });
  await page.goto(`${baseUrl}/returns`);

  const row = page.getByRole('row').filter({ hasText: 'E2E-RET-1' });
  await row.getByRole('button', { name: 'Download' }).click();
  const download = page.getByRole('dialog').getByRole('link', { name: 'Download return label' });
  await expect(download).toHaveAttribute('href', signedPdfUrl);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('CP-058 AC-6: the billing-date surface is staff-only', async ({ page }) => {
  // Staff see it.
  const staffErrors = await setupPortal(page, { admin: true, returnOverrides: { status: 'requested' } });
  await page.goto(`${baseUrl}/returns`);
  await page.getByRole('button', { name: 'View return E2E-RET-1' }).click();
  await expect(page.getByRole('dialog').getByText('Correct billing date')).toBeVisible();
  expect(staffErrors, staffErrors.join('\n')).toEqual([]);
});

test('CP-058 AC-6: a client user cannot see the billing-date surface at all', async ({ page }) => {
  // Not merely disabled — absent. AC-6 says clients can neither edit the date nor see the
  // audit, and a visible-but-disabled control still discloses that the capability exists.
  const errors = await setupPortal(page, { admin: false, returnOverrides: { status: 'requested' } });
  await page.goto(`${baseUrl}/returns`);
  await page.getByRole('button', { name: 'View return E2E-RET-1' }).click();
  await expect(page.getByRole('dialog').getByText('Correct billing date')).toHaveCount(0);
  expect(errors, errors.join('\n')).toEqual([]);
});
