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
const dialogFocus = read('portal-client/src/components/ui/useDialogFocus.ts');
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

// ── Can never strand a blocking overlay: CSS-transition drawer, pointer-events
//    disabled + off-screen/transparent when closed (no animation that can hang) ──
assert(
  layout.includes("drawer ? 'opacity-100' : 'pointer-events-none opacity-0'") &&
    layout.includes("drawer ? 'translate-x-0' : 'pointer-events-none -translate-x-[120%]'"),
  'drawer uses CSS transitions and is pointer-events-none + off-screen when closed (cannot get stuck over the page)',
);

// ── Background scroll lock while open ──
assert(
  layout.includes('useDialogFocus(drawer') &&
    dialogFocus.includes("document.body.style.overflow = 'hidden'") &&
    dialogFocus.includes('document.body.style.overflow = previousOverflow'),
  'the shared dialog hook locks background scroll while the drawer is open and restores it on close',
);
assert(
  !layout.includes('document.body.style.overflow'),
  'Layout does not add a second body scroll lock that can restore overflow:hidden after navigation',
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

// ── Mobile bottom tab bar (tabs + center create action) ──
const inbound = read('portal-client/src/pages/Inbound.tsx');
assert(
  layout.includes('<BottomNav />'),
  'Layout renders the mobile bottom tab bar',
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
  bottomNav.includes('aria-label="New inbound"') && bottomNav.includes("nav('/inbound?new=1')"),
  'bottom bar has a raised center + create action that routes to New inbound',
);
assert(
  bottomNav.includes('env(safe-area-inset-bottom)'),
  'bottom bar respects the iOS home-indicator safe area',
);
assert(
  inbound.includes("searchParams.get('new')") && inbound.includes('if (isAdmin) setModalOpen(true)'),
  'Inbound auto-opens the create modal for admins arriving via the + (?new=1); clients just see the list',
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
