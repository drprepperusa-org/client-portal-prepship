import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const baseUrl = process.env.UI_AUDIT_BASE_URL ?? 'http://127.0.0.1:5174';
const clientName = process.env.UI_AUDIT_CLIENT_NAME ?? 'Heritage Kids Press';
const screenshotDir = process.env.UI_AUDIT_SCREENSHOT_DIR ?? '';

const routes = [
  ['/dashboard', 'Dashboard'],
  ['/dashboard/orders', 'Orders'],
  ['/dashboard/inbound', 'Inbound'],
  ['/dashboard/inventory', 'Inventory'],
  ['/dashboard/shipments', 'Shipments'],
  ['/dashboard/analysis', 'Analysis'],
  ['/dashboard/reports', 'Reports'],
  ['/dashboard/invoices', 'Invoices'],
];

const restrictedRoutes = [
  '/dashboard/connections',
  '/dashboard/settings',
  '/dashboard/settings/system',
];

const forbiddenCopy = [
  'Acme Brands',
  'Demo workspace',
  'Client operations',
  'assigned client/store scope',
  'Need Help',
  'PrepShip Support',
];

const forbiddenSidebarCopy = [
  'Admin',
  'Store Connections',
  'Settings',
  'Integrations',
  'Billing',
];

function countOccurrences(text, needle) {
  if (!needle) return 0;
  return (text.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const findings = [];
  const screenshotRoot = screenshotDir || path.join(os.tmpdir(), 'prepship-ui-audit');

  if (screenshotDir) {
    await mkdir(screenshotRoot, { recursive: true });
  }

  await page.goto(new URL('/login', baseUrl).toString(), { waitUntil: 'networkidle' });
  await page.evaluate(() => window.localStorage.setItem('clientPortal.demo', 'true'));

  for (const [route, label] of routes) {
    const url = new URL(route, baseUrl).toString();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(250);

    const result = await page.evaluate(({ expectedTitle, clientName: scopedClientName }) => {
      const text = document.body.innerText;
      const sidebarText = document.querySelector('aside[aria-label="Client portal navigation"]')?.textContent ?? '';
      const logo = document.querySelector('.portal-logo-image');
      const hasLoadedLogo = logo instanceof HTMLImageElement && logo.complete && logo.naturalWidth > 0;
      const missingExpectedTitle = !text.includes(expectedTitle);
      const isLoginGate = /sign in|portal access/i.test(text) && !text.includes(expectedTitle);
      const hasHorizontalOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
      const sidebarHasRequiredItems = [
        'Dashboard',
        'Orders',
        'Inbound',
        'Inventory',
        'Shipments',
        'Analysis',
        'Reports',
        'Invoices',
      ].every((item) => sidebarText.includes(item));
      return {
        text,
        sidebarText,
        hasLoadedLogo,
        missingExpectedTitle,
        isLoginGate,
        hasHorizontalOverflow,
        sidebarHasRequiredItems,
        clientCount: scopedClientName ? (text.match(new RegExp(scopedClientName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length : 0,
      };
    }, { expectedTitle: label, clientName });

    if (screenshotDir) {
      await page.screenshot({ path: path.join(screenshotRoot, `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`), fullPage: false });
    }

    if (result.isLoginGate) findings.push({ route, issue: 'Page is blocked by login instead of rendering the portal route.' });
    if (result.missingExpectedTitle) findings.push({ route, issue: `Expected visible page title "${label}" was not found.` });
    if (!result.hasLoadedLogo) findings.push({ route, issue: 'PrepShip sidebar logo asset is missing or did not load.' });
    if (result.hasHorizontalOverflow) findings.push({ route, issue: 'Page has document-level horizontal overflow.' });
    if (!result.sidebarHasRequiredItems) findings.push({ route, issue: 'Sidebar does not match the required PrepShip v4 navigation labels.' });

    for (const copy of forbiddenCopy) {
      if (result.text.includes(copy)) findings.push({ route, issue: `Unwanted visible copy found: "${copy}".` });
    }

    for (const copy of forbiddenSidebarCopy) {
      if (result.sidebarText.includes(copy)) findings.push({ route, issue: `Unwanted sidebar label found: "${copy}".` });
    }

    if (result.clientCount > 1) {
      findings.push({
        route,
        issue: `Single-client label "${clientName}" appears ${result.clientCount} times; reduce repeated account/store labels.`,
      });
    }
  }

  for (const route of restrictedRoutes) {
    const url = new URL(route, baseUrl).toString();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(250);
    const currentPath = new URL(page.url()).pathname;
    const text = await page.locator('body').innerText();
    if (currentPath !== '/dashboard') {
      findings.push({ route, issue: `Non-admin route was not redirected to /dashboard; current path is ${currentPath}.` });
    }
    if (text.includes('Settings') || text.includes('Store Connections')) {
      findings.push({ route, issue: 'Non-admin direct route rendered admin-only content.' });
    }
  }

  await browser.close();

  const summary = {
    baseUrl,
    routesChecked: routes.length,
    restrictedRoutesChecked: restrictedRoutes.length,
    clientName,
    screenshots: screenshotDir ? screenshotRoot : 'not captured; set UI_AUDIT_SCREENSHOT_DIR to save them',
    findings,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (findings.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
