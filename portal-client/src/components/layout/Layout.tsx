import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { BottomNav } from './BottomNav';
import { LiquidBackground } from './LiquidBackground';
import { ConnectionStatus } from '../ConnectionStatus';
import { NAV, COMPONENTS_NAV } from '@/nav';
import { pageVariants } from '@/lib/motion';
import { usePrefetchPortal } from '@/lib/hooks';
import { cn } from '@/lib/cn';
import { useDialogFocus } from '@/components/ui/useDialogFocus';

function useTitle() {
  const { pathname } = useLocation();
  const all = [...NAV, COMPONENTS_NAV];
  const match = all.find((n) => (n.to === '/' ? pathname === '/' : pathname.startsWith(n.to)));
  return match?.label ?? 'Dashboard';
}

export function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const mobileNavRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const title = useTitle();
  usePrefetchPortal();
  useDialogFocus(drawer, () => setDrawer(false), mobileNavRef);

  // Close the mobile drawer on EVERY route change, so navigating never leaves
  // the drawer (or its backdrop) stuck over the new page. This is the reliable
  // close — each nav item's onNavigate is now just a nicety, and any other
  // navigation (redirect, back button, programmatic) also dismisses it.
  useEffect(() => {
    setDrawer(false);
  }, [pathname]);

  return (
    <div className="relative min-h-screen">
      <a
        href="#portal-main"
        className="focus-ring sr-only fixed left-4 top-4 z-[100] rounded-lg bg-white px-4 py-2 font-semibold text-brand-700 shadow-glass focus:not-sr-only"
      >
        Skip to main content
      </a>
      <LiquidBackground />
      <ConnectionStatus />

      {/* Capped + centered: pages hug a readable width on wide monitors
          instead of stretching w-full with dead white space. */}
      <div className="relative z-10 mx-auto flex w-full max-w-[1680px] gap-3 p-3 sm:gap-4 sm:p-4">
        {/* Desktop sidebar */}
        <aside className={cn('relative hidden shrink-0 lg:block', collapsed ? 'w-[76px]' : 'w-64', 'transition-[width] duration-300')}>
          <div className="sticky top-4 h-[calc(100vh-2rem)]">
            <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
          </div>
        </aside>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col gap-3 sm:gap-4">
          <Topbar title={title} onOpenMenu={() => setDrawer(true)} />
          {/* Enter-only page transition, keyed by path. We intentionally do NOT
              wrap <Outlet/> in <AnimatePresence mode="wait">: because Outlet
              renders the *incoming* route's content even inside the exiting
              element, the mode="wait" handoff could mount the new page stuck at
              its `initial` (opacity:0) state → a blank content area on nav.
              Re-keying the motion.div replays initial→enter on every route. */}
          {/* pb-24 on phones clears the fixed bottom tab bar; none at lg+. */}
          <main id="portal-main" tabIndex={-1} className="min-h-[calc(100vh-6rem)] pb-24 lg:pb-0">
            <motion.div key={pathname} variants={pageVariants} initial="initial" animate="enter">
              <Outlet />
            </motion.div>
          </main>
        </div>
      </div>

      {/* Mobile drawer — hoisted to the page root so it stacks ABOVE the fixed
          bottom bar (panel z-50 / backdrop z-40 > bar z-30). Driven by CSS
          transitions (NOT AnimatePresence) so it can never get "stuck": when
          closed, BOTH layers are pointer-events-none and off-screen/transparent,
          so nothing blocks the page — even mid-transition. Always mounted, so
          there is no enter/exit animation that can hang. */}
      <div
        onClick={() => setDrawer(false)}
        aria-hidden={!drawer}
        className={cn(
          'fixed inset-0 z-40 bg-ink/30 backdrop-blur-sm transition-opacity duration-300 lg:hidden',
          drawer ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      <div
        ref={mobileNavRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        aria-hidden={!drawer}
        {...(!drawer ? ({ inert: '' } as Record<string, string>) : {})}
        tabIndex={-1}
        className={cn(
          'fixed left-3 top-3 z-50 h-[calc(100vh-1.5rem)] w-64 max-w-[calc(100vw-1.5rem)] transition-transform duration-300 ease-out lg:hidden',
          drawer ? 'translate-x-0' : 'pointer-events-none -translate-x-[120%]',
        )}
      >
        <Sidebar collapsed={false} onToggle={() => {}} onNavigate={() => setDrawer(false)} />
      </div>

      {/* Mobile bottom tab bar — primary destinations + a center create action.
          The full nav (overflow destinations) opens from the top-left menu.
          Hidden at lg+ where the sidebar is the nav. */}
      <BottomNav />
    </div>
  );
}
