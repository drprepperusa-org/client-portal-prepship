// Mobile navigation must never leave the sidebar drawer stuck over the page.
// Pins the reliable-close behavior: the drawer closes on EVERY route change
// (not only on a nav-item tap), backdrop + panel are keyed for clean exit,
// tapping the backdrop dismisses it, background scroll locks while open, and
// the hamburger toggle exists in the top bar below lg.
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASS ${message}`);
}

const layout = read('portal-client/src/components/layout/Layout.tsx');
const topbar = read('portal-client/src/components/layout/Topbar.tsx');
const sidebar = read('portal-client/src/components/layout/Sidebar.tsx');
const bottomNav = read('portal-client/src/components/layout/BottomNav.tsx');
const packageJson = JSON.parse(read('package.json'));

// ── The fix: close the drawer on route change ──
assert(
  /useEffect\(\(\)\s*=>\s*\{\s*setDrawer\(false\);\s*\},\s*\[pathname\]\)/.test(layout),
  'Layout closes the mobile drawer on every route change (useEffect on [pathname]) — no stuck drawer after navigating',
);
assert(
  layout.includes('onClick={() => setDrawer(false)}'),
  'tapping the backdrop also dismisses the drawer',
);

// ── Clean unmount: keyed AnimatePresence children (a Fragment can't exit-animate) ──
assert(
  layout.includes('key="drawer-backdrop"') && layout.includes('key="drawer-panel"'),
  'drawer backdrop + panel are separate keyed AnimatePresence children (clean exit, no stranded backdrop)',
);

// ── Background scroll lock while open ──
assert(
  layout.includes('document.body.style.overflow'),
  'background scroll is locked while the drawer is open',
);

// ── The drawer is mobile-only; the desktop rail is lg+ ──
assert(
  layout.includes('lg:hidden') && layout.includes('lg:block'),
  'drawer is lg:hidden and the desktop sidebar is lg:block (mobile vs desktop nav)',
);

// ── Hamburger toggle exists in the top bar below lg ──
assert(
  topbar.includes('onClick={onOpenMenu}') && topbar.includes('aria-label="Open menu"') && topbar.includes('lg:hidden'),
  'top bar exposes a hamburger (aria-label "Open menu") that opens the drawer, hidden at lg+',
);

// ── Nav items still request a close on tap (belt-and-suspenders) ──
assert(
  sidebar.includes('onClick={onNavigate}'),
  'sidebar nav items call onNavigate on tap',
);

// ── Mobile bottom tab bar ──
assert(
  layout.includes('<BottomNav onOpenMore={() => setDrawer(true)} />'),
  'Layout renders the bottom tab bar; its More tab opens the full drawer',
);
assert(
  layout.includes('pb-24 lg:pb-0'),
  'main content clears the fixed bottom bar on phones (pb-24) and not on desktop',
);
assert(
  bottomNav.includes('lg:hidden') && bottomNav.includes('fixed inset-x-0 bottom-0'),
  'bottom tab bar is a fixed, mobile-only (lg:hidden) bar pinned to the bottom',
);
assert(
  bottomNav.includes('onClick={onOpenMore}') && bottomNav.includes("label=\"More\""),
  'bottom bar has a More tab that opens the drawer for the overflow destinations',
);
assert(
  bottomNav.includes('env(safe-area-inset-bottom)'),
  'bottom bar respects the iOS home-indicator safe area',
);

assert(
  packageJson.scripts?.['test:client-portal-mobile-nav'] ===
    'node scripts/client-portal-mobile-nav-guard.mjs',
  'package exposes test:client-portal-mobile-nav',
);

if (process.exitCode) {
  process.exit(process.exitCode);
}
console.log('\nclient portal mobile nav guard passed.');
