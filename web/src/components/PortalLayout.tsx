import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { Bell, ChevronDown, Menu, Store, X } from 'lucide-react';
import { useAuth } from '../lib/auth';
import ClientPortalSidebar, { clientPortalNavItems } from './ui/sidebar-component';
import { AppleSpotlight } from './ui/apple-spotlight';
import { SearchBarButton } from './ui/search-bar';

export default function PortalLayout() {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [sidebarPinned, setSidebarPinned] = useState(true);
  const [spotlightOpen, setSpotlightOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<'stores' | 'notifications' | 'account' | null>(null);
  const activeTitle =
    clientPortalNavItems.find((item) =>
      item.end ? location.pathname === item.to : location.pathname.startsWith(item.to),
    ) ?? clientPortalNavItems[0]!;
  const userEmail = auth.user?.email ?? 'client@prepship.com';
  const metadataName = typeof auth.user?.user_metadata?.name === 'string' ? auth.user.user_metadata.name : '';
  const userName = metadataName || userEmail.split('@')[0]?.replace(/[._-]/g, ' ') || 'Client';
  const displayName = userName
    .split(' ')
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
  const workspaceLabel = auth.isDemo ? 'Demo mode' : 'PrepShip account';

  useEffect(() => {
    setMobileNavOpen(false);
    setOpenMenu(null);
  }, [location.pathname]);

  // Global ⌘K / Ctrl+K opens spotlight
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
      const trigger = (isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 'k';
      if (trigger) {
        e.preventDefault();
        setSpotlightOpen((v) => !v);
      }
    }
    function onOpenEvent() {
      setSpotlightOpen(true);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('open-spotlight', onOpenEvent);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('open-spotlight', onOpenEvent);
    };
  }, []);

  const handleSpotlightNavigate = useCallback(
    (link: string) => {
      navigate(link);
    },
    [navigate],
  );

  function toggleMenu(menu: 'stores' | 'notifications' | 'account') {
    setOpenMenu((current) => (current === menu ? null : menu));
  }

  return (
    <div className={`portal-shell${mobileNavOpen ? ' portal-nav-open' : ''}`}>
      <button
        type="button"
        className="portal-mobile-menu-button"
        aria-label={mobileNavOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={mobileNavOpen}
        onClick={() => setMobileNavOpen((value) => !value)}
      >
        {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
      </button>
      <button
        type="button"
        className="portal-mobile-backdrop"
        aria-label="Close navigation"
        onClick={() => setMobileNavOpen(false)}
      />
      <ClientPortalSidebar
        mobileOpen={mobileNavOpen}
        expanded={sidebarExpanded}
        pinned={sidebarPinned}
        onExpandedChange={setSidebarExpanded}
        onPinnedChange={setSidebarPinned}
        onNavigate={() => setMobileNavOpen(false)}
      />

      <div className={`portal-main portal-main-with-drawer${sidebarPinned ? ' portal-main-with-drawer-pinned' : ''}`}>
        <header className="portal-topbar">
          <div className="flex flex-1 items-center justify-center px-4">
            <SearchBarButton
              containerClassName="max-w-[560px]"
              placeholder="Search orders, SKUs, shipments, PO's, tracking IDs…"
              onClick={() => setSpotlightOpen(true)}
              hint="⌘K"
            />
          </div>
          <div className="portal-topbar-actions">
            <div className="relative">
              <button
                type="button"
                className="portal-store-select"
                aria-label="Select store scope"
                aria-expanded={openMenu === 'stores'}
                onClick={() => toggleMenu('stores')}
              >
                <Store size={16} />
                <span>All Stores</span>
                <ChevronDown size={15} />
              </button>
              {openMenu === 'stores' ? (
                <div aria-label="Store scope menu" className="absolute right-0 top-[calc(100%+8px)] z-[120] w-72 rounded-md border border-line bg-surface p-3 text-sm text-ink shadow-lg">
                  <div className="text-[11px] font-semibold uppercase text-ink-3">Assigned scope</div>
                  <div className="mt-2 rounded-md bg-surface-2 px-3 py-2">
                    <div className="font-semibold">DrPrepperUSA</div>
                    <div className="mt-0.5 text-xs text-ink-3">All stores visible to this portal session</div>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="relative">
              <button
                type="button"
                className="portal-bell-button"
                aria-label="Notifications"
                aria-expanded={openMenu === 'notifications'}
                onClick={() => toggleMenu('notifications')}
              >
                <Bell size={19} />
                <span>7</span>
              </button>
              {openMenu === 'notifications' ? (
                <div aria-label="Notification center menu" className="absolute right-0 top-[calc(100%+8px)] z-[120] w-80 rounded-md border border-line bg-surface p-3 text-sm text-ink shadow-lg">
                  <div className="font-semibold">Notification center</div>
                  <div className="mt-1 text-xs text-ink-3">7 active alerts</div>
                  <div className="mt-3 space-y-2">
                    <div className="rounded-md bg-surface-2 px-3 py-2 text-xs">Orders and shipment sync are current.</div>
                    <div className="rounded-md bg-surface-2 px-3 py-2 text-xs">Inventory alerts are available from the Overview rail.</div>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="relative">
              <button
                type="button"
                className="portal-user-menu"
                aria-label="Account menu"
                aria-expanded={openMenu === 'account'}
                onClick={() => toggleMenu('account')}
              >
                <span className="portal-user-photo">{displayName.slice(0, 1)}</span>
                <span className="portal-user-copy">
                  <strong>{displayName || 'Client'}</strong>
                  <small>{workspaceLabel}</small>
                </span>
                <ChevronDown size={15} />
              </button>
              {openMenu === 'account' ? (
                <div aria-label="Account details menu" className="absolute right-0 top-[calc(100%+8px)] z-[120] w-72 rounded-md border border-line bg-surface p-3 text-sm text-ink shadow-lg">
                  <div className="font-semibold">{displayName || 'Client'}</div>
                  <div className="mt-1 text-xs text-ink-3">{userEmail}</div>
                  <div className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-xs">{workspaceLabel}</div>
                  <button
                    type="button"
                    onClick={() => void auth.signOut().then(() => navigate('/login'))}
                    className="mt-3 h-8 w-full rounded-md border border-line bg-surface text-xs font-semibold text-ink-2 hover:bg-surface-2"
                  >
                    Sign out
                  </button>
                </div>
              ) : null}
            </div>
            {auth.isDemo ? <div className="portal-demo-pill">Demo data</div> : null}
          </div>
        </header>
        <main className="portal-content">
          <div className="portal-page-context">
            <div>
              <span>{activeTitle.group}</span>
              <strong>{activeTitle.label}</strong>
            </div>
            <p>{activeTitle.description}</p>
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <AppleSpotlight
        isOpen={spotlightOpen}
        onClose={() => setSpotlightOpen(false)}
        onNavigate={handleSpotlightNavigate}
      />
    </div>
  );
}
