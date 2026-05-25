import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  BarChart3,
  Boxes,
  LayoutDashboard,
  LogOut,
  Menu,
  PackagePlus,
  Plug,
  Settings,
  X,
  ShoppingCart,
  Receipt,
  Truck,
} from 'lucide-react';
import { useAuth } from '../lib/auth';

const navItems = [
  { to: '/dashboard', label: 'Dashboard', description: 'Executive status board', group: 'Operations', icon: LayoutDashboard, end: true },
  { to: '/dashboard/orders', label: 'Orders', description: 'Client-scoped order queue', group: 'Operations', icon: ShoppingCart },
  { to: '/dashboard/inbound', label: 'Inbound', description: 'Restock and receiving watch', group: 'Operations', icon: PackagePlus },
  { to: '/dashboard/inventory', label: 'Inventory', description: 'SKU stock visibility', group: 'Operations', icon: Boxes },
  { to: '/dashboard/shipments', label: 'Shipments', description: 'Tracking and label history', group: 'Operations', icon: Truck },
  { to: '/dashboard/reports', label: 'Reports', description: 'Scoped operating trends', group: 'Finance & Insights', icon: BarChart3 },
  { to: '/dashboard/invoices', label: 'Invoices', description: 'Billing summaries', group: 'Finance & Insights', icon: Receipt },
  { to: '/dashboard/connections', label: 'Store Connections', description: 'Marketplace credentials', group: 'Admin', icon: Plug },
  { to: '/dashboard/settings', label: 'Settings', description: 'Account and scope', group: 'Admin', icon: Settings },
];
const navGroups = Array.from(new Set(navItems.map((item) => item.group)));

export default function PortalLayout() {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const email = auth.user?.email ?? 'admin@drprepper.com';
  const activeTitle =
    navItems.find((item) =>
      item.end ? location.pathname === item.to : location.pathname.startsWith(item.to),
    ) ?? navItems[0]!;

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
      <aside className="portal-sidebar">
        <Link to="/dashboard" className="portal-brand">
          DR PREPPER<span>USA</span>
        </Link>
        <nav className="portal-nav">
          {navGroups.map((group) => (
            <div className="portal-nav-group" key={group}>
              <div className="portal-nav-group-label">{group}</div>
              {navItems.filter((item) => item.group === group).map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) => `portal-nav-link ${isActive ? 'active' : ''}`}
                  >
                    <Icon size={18} />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="portal-sidebar-foot">
          <div className="portal-user">
            <div className="portal-user-avatar">D</div>
            <div className="portal-user-meta">
              <div className="portal-user-name">Drprepper</div>
              <div className="portal-user-email">{email}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void auth.signOut().then(() => navigate('/login'))}
            className="portal-logout"
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>

      <div className="portal-main">
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
