import { Outlet, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { useAuth } from '../lib/auth';
import ClientPortalSidebar, { clientPortalNavItems } from './ui/sidebar-component';

export default function PortalLayout() {
  const auth = useAuth();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [sidebarPinned, setSidebarPinned] = useState(false);
  const activeTitle =
    clientPortalNavItems.find((item) =>
      item.end ? location.pathname === item.to : location.pathname.startsWith(item.to),
    ) ?? clientPortalNavItems[0]!;

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

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
          <div>
            <div className="portal-topbar-title">{activeTitle.label}</div>
            <div className="portal-topbar-subtitle">{activeTitle.description}</div>
          </div>
          {auth.isDemo ? <div className="portal-demo-pill">Demo data</div> : null}
        </header>
        <main className="portal-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
