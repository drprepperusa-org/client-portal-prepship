import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { LiquidBackground } from './LiquidBackground';
import { NAV, COMPONENTS_NAV } from '@/nav';
import { pageVariants } from '@/lib/motion';
import { usePrefetchPortal } from '@/lib/hooks';
import { cn } from '@/lib/cn';

function useTitle() {
  const { pathname } = useLocation();
  const all = [...NAV, COMPONENTS_NAV];
  const match = all.find((n) => (n.to === '/' ? pathname === '/' : pathname.startsWith(n.to)));
  return match?.label ?? 'Dashboard';
}

export function Layout() {
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const { pathname } = useLocation();
  const title = useTitle();
  usePrefetchPortal();

  return (
    <div className="relative min-h-screen">
      <LiquidBackground />

      {/* Capped + centered: pages hug a readable width on wide monitors
          instead of stretching w-full with dead white space. */}
      <div className="relative z-10 mx-auto flex w-full max-w-[1680px] gap-3 p-3 sm:gap-4 sm:p-4">
        {/* Desktop sidebar */}
        <aside className={cn('relative hidden shrink-0 lg:block', collapsed ? 'w-[76px]' : 'w-64', 'transition-[width] duration-300')}>
          <div className="sticky top-4 h-[calc(100vh-2rem)]">
            <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
          </div>
        </aside>

        {/* Mobile drawer */}
        <AnimatePresence>
          {drawer && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDrawer(false)} className="fixed inset-0 z-40 bg-ink/30 backdrop-blur-sm lg:hidden" />
              <motion.div initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ type: 'spring', stiffness: 320, damping: 34 }} className="fixed left-3 top-3 z-50 h-[calc(100vh-1.5rem)] w-64 lg:hidden">
                <Sidebar collapsed={false} onToggle={() => {}} onNavigate={() => setDrawer(false)} />
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col gap-3 sm:gap-4">
          <Topbar title={title} onOpenMenu={() => setDrawer(true)} />
          {/* Enter-only page transition, keyed by path. We intentionally do NOT
              wrap <Outlet/> in <AnimatePresence mode="wait">: because Outlet
              renders the *incoming* route's content even inside the exiting
              element, the mode="wait" handoff could mount the new page stuck at
              its `initial` (opacity:0) state → a blank content area on nav.
              Re-keying the motion.div replays initial→enter on every route. */}
          <main className="min-h-[calc(100vh-6rem)]">
            <motion.div key={pathname} variants={pageVariants} initial="initial" animate="enter">
              <Outlet />
            </motion.div>
          </main>
        </div>
      </div>
    </div>
  );
}
