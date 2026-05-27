import { Outlet, useLocation, useNavigate } from 'react-router-dom';
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
            <button type="button" className="portal-store-select" aria-label="Select store scope">
              <Store size={16} />
              <span>All Stores</span>
              <ChevronDown size={15} />
            </button>
            <button type="button" className="portal-bell-button" aria-label="Notifications">
              <Bell size={19} />
              <span>7</span>
            </button>
            <button type="button" className="portal-user-menu" aria-label="Account menu">
              <span className="portal-user-photo">{displayName.slice(0, 1)}</span>
              <span className="portal-user-copy">
                <strong>{displayName || 'Client'}</strong>
                <small>{workspaceLabel}</small>
              </span>
              <ChevronDown size={15} />
            </button>
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
          <Outlet />
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
