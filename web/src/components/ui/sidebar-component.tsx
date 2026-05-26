import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Boxes,
  ChevronRight,
  Clock3,
  Database,
  FlaskConical,
  LayoutDashboard,
  LogOut,
  MapPin,
  PackagePlus,
  Percent,
  Plug,
  Receipt,
  Server,
  Settings,
  ShoppingCart,
  TrendingUp,
  Truck,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';

export type SidebarNavItem = {
  to: string;
  label: string;
  description: string;
  group: string;
  icon: LucideIcon;
  end?: boolean;
  children?: Array<{
    to: string;
    label: string;
    icon: LucideIcon;
  }>;
};

const settingsSubItems: SidebarNavItem['children'] = [
  { to: '/dashboard/settings/markups', label: 'Markups', icon: Percent },
  { to: '/dashboard/settings/locations', label: 'Locations', icon: MapPin },
  { to: '/dashboard/settings/pending', label: 'Pending', icon: Clock3 },
  { to: '/dashboard/settings/sandbox', label: 'Sandbox', icon: FlaskConical },
  { to: '/dashboard/settings/cache', label: 'Cache', icon: Database },
  { to: '/dashboard/settings/system', label: 'System', icon: Server },
];

export const clientPortalNavItems: SidebarNavItem[] = [
  { to: '/dashboard', label: 'Dashboard', description: 'Executive status board', group: 'Operations', icon: LayoutDashboard, end: true },
  { to: '/dashboard/orders', label: 'Orders', description: 'Client-scoped order queue', group: 'Operations', icon: ShoppingCart },
  { to: '/dashboard/inbound', label: 'Inbound', description: 'Restock and receiving watch', group: 'Operations', icon: PackagePlus },
  { to: '/dashboard/inventory', label: 'Inventory', description: 'SKU stock visibility', group: 'Operations', icon: Boxes },
  { to: '/dashboard/shipments', label: 'Shipments', description: 'Tracking and label history', group: 'Operations', icon: Truck },
  { to: '/dashboard/analysis', label: 'Analysis', description: 'SKU trends and profitability', group: 'Finance & Insights', icon: TrendingUp },
  { to: '/dashboard/reports', label: 'Reports', description: 'Scoped operating trends', group: 'Finance & Insights', icon: BarChart3 },
  { to: '/dashboard/invoices', label: 'Invoices', description: 'Billing summaries', group: 'Finance & Insights', icon: Receipt },
  { to: '/dashboard/connections', label: 'Store Connections', description: 'Marketplace credentials', group: 'Admin', icon: Plug },
  { to: '/dashboard/settings/system', label: 'Settings', description: 'Account, scope, and backfill', group: 'Admin', icon: Settings, children: settingsSubItems },
];

const navGroups = Array.from(new Set(clientPortalNavItems.map((item) => item.group)));

type ClientPortalSidebarProps = {
  mobileOpen: boolean;
  expanded: boolean;
  pinned: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onPinnedChange: (pinned: boolean) => void;
  onNavigate?: () => void;
};

export default function ClientPortalSidebar({
  mobileOpen,
  expanded,
  pinned,
  onExpandedChange,
  onPinnedChange,
  onNavigate,
}: ClientPortalSidebarProps) {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const email = auth.user?.email ?? 'admin@drprepper.com';
  const initial = email.slice(0, 1).toUpperCase() || 'D';
  const showText = expanded || pinned || mobileOpen;
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => ({
    settings: location.pathname.startsWith('/dashboard/settings'),
  }));

  const handleMouseEnter = () => {
    if (!pinned) onExpandedChange(true);
  };

  const handleMouseLeave = () => {
    if (!pinned) onExpandedChange(false);
  };

  const togglePinned = () => {
    const nextPinned = !pinned;
    onPinnedChange(nextPinned);
    onExpandedChange(nextPinned);
  };

  const toggleNavGroup = (key: string) => {
    setOpenGroups((current) => ({ ...current, [key]: !current[key] }));
  };

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-[70] flex h-screen flex-col border-r border-[#dbe6ef] bg-white/95 shadow-[14px_0_40px_rgba(18,40,63,.08)] backdrop-blur-xl transition-[width,transform,box-shadow] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none ${mobileOpen ? 'translate-x-0 w-[min(86vw,320px)]' : '-translate-x-full w-[min(86vw,320px)] lg:translate-x-0'
        } ${showText ? 'lg:w-[284px]' : 'lg:w-[78px] lg:hover:shadow-[18px_0_50px_rgba(18,40,63,.12)]'}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      aria-label="Client portal navigation"
    >
      <div className="flex h-full min-h-0 flex-col p-3">
        <div className="relative">
          <Link
            to="/dashboard"
            onClick={onNavigate}
            className={`group flex h-14 items-center rounded-xl transition-colors duration-200 hover:bg-[#eef8fe] ${showText ? 'gap-3 px-3 pr-10' : 'justify-center px-0'
              }`}
            aria-label="DR PREPPERUSA Dashboard"
          >
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#03b0f7] font-black text-white shadow-[0_14px_28px_rgba(3,176,247,.22)]">
              P
            </div>
            <div className={`min-w-0 overflow-hidden transition-all duration-300 ease-[cubic-bezier(.2,.8,.2,1)] ${showText ? 'max-w-[176px] translate-x-0 opacity-100' : 'max-w-0 -translate-x-1 opacity-0'}`}>
              <div className="whitespace-nowrap text-[15px] font-black tracking-[-0.04em] text-[#142033]">
                DR PREPPER<span className="text-[#03b0f7]">USA</span>
              </div>
              <div className="whitespace-nowrap text-[10px] font-black uppercase tracking-[0.14em] text-[#7a889a]">
                Client Portal
              </div>
            </div>
          </Link>
          <button
            type="button"
            onClick={togglePinned}
            className={`absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg border border-[#dbe6ef] bg-white text-[#63758c] shadow-sm transition-all duration-300 hover:-translate-y-[52%] hover:bg-[#e7f7ff] hover:text-[#0a5f86] active:translate-y-[-48%] motion-reduce:transform-none ${showText ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
            aria-label={pinned ? 'Collapse sidebar' : 'Pin sidebar open'}
            aria-pressed={pinned}
            title={pinned ? 'Collapse sidebar' : 'Pin sidebar open'}
          >
            <ChevronRight
              size={17}
              strokeWidth={2.4}
              className={`transition-transform duration-300 ${pinned ? 'rotate-180' : 'rotate-0'}`}
            />
          </button>
        </div>

        <nav
          className="portal-sidebar-scrollbarless mt-3 min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
          aria-label="Main navigation"
        >
          {navGroups.map((group) => (
            <div key={group} className="mb-2 last:mb-1">
              <div className={`mb-1.5 px-3 text-[10px] font-black uppercase tracking-[0.14em] text-[#7a889a] transition-all duration-200 ${showText ? 'h-4 opacity-100' : 'h-0 opacity-0'}`}>
                {group}
              </div>
              <div className="space-y-1">
                {clientPortalNavItems.filter((item) => item.group === group).map((item) => {
                  const Icon = item.icon;
                  const childActive = item.children?.some((child) => location.pathname === child.to) === true;
                  const hasChildren = Boolean(item.children?.length);
                  const childOpen = openGroups[item.label.toLowerCase()] ?? childActive;
                  return (
                    <div key={item.to}>
                      {hasChildren ? (
                        <button
                          type="button"
                          onClick={() => {
                            toggleNavGroup(item.label.toLowerCase());
                            if (!showText) onExpandedChange(true);
                          }}
                          title={showText ? undefined : item.label}
                          className={`group relative flex h-[38px] w-full items-center rounded-xl text-left text-sm font-black transition-all duration-200 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#03b0f7]/35 ${showText ? 'justify-start gap-3 px-3' : 'justify-center px-0'
                          } ${childActive || childOpen
                            ? 'bg-[#e7f7ff] text-[#0a5f86] ring-1 ring-[#03b0f7]/25'
                            : 'text-[#34445a] hover:-translate-y-0.5 hover:bg-[#f0f9ff] hover:text-[#0a5f86] motion-reduce:transform-none'
                          }`}
                        >
                          <>
                            <span
                              className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors duration-200 ${childActive || childOpen ? 'bg-white text-[#03b0f7] shadow-sm' : 'text-[#63758c] group-hover:bg-white group-hover:text-[#03b0f7]'
                                }`}
                            >
                              <Icon size={18} strokeWidth={2} />
                            </span>
                            <span className={`min-w-0 flex-1 overflow-hidden whitespace-nowrap text-left transition-all duration-300 ease-[cubic-bezier(.2,.8,.2,1)] ${showText ? 'max-w-[160px] translate-x-0 opacity-100' : 'max-w-0 -translate-x-1 opacity-0'}`}>
                              {item.label}
                            </span>
                            <ChevronRight
                              size={15}
                              className={`shrink-0 text-[#93a1b2] transition-all duration-300 ${showText ? 'opacity-100' : 'w-0 opacity-0'} ${childOpen ? 'rotate-90' : ''}`}
                            />
                          </>
                        </button>
                      ) : (
                        <NavLink
                          to={item.to}
                          end={item.end}
                          onClick={onNavigate}
                          title={showText ? undefined : item.label}
                          className={({ isActive }) =>
                            `group relative flex h-[38px] items-center rounded-xl text-sm font-black transition-all duration-200 ease-out ${showText ? 'gap-3 px-3' : 'justify-center px-0'
                            } ${isActive
                              ? 'bg-[#e7f7ff] text-[#0a5f86] ring-1 ring-[#03b0f7]/25'
                              : 'text-[#34445a] hover:-translate-y-0.5 hover:bg-[#f0f9ff] hover:text-[#0a5f86] motion-reduce:transform-none'
                            }`
                          }
                        >
                          {({ isActive }) => (
                            <>
                              <span
                                className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors duration-200 ${isActive ? 'bg-white text-[#03b0f7] shadow-sm' : 'text-[#63758c] group-hover:bg-white group-hover:text-[#03b0f7]'
                                  }`}
                              >
                                <Icon size={18} strokeWidth={2} />
                              </span>
                              <span className={`min-w-0 flex-1 overflow-hidden whitespace-nowrap transition-all duration-300 ease-[cubic-bezier(.2,.8,.2,1)] ${showText ? 'max-w-[160px] translate-x-0 opacity-100' : 'max-w-0 -translate-x-1 opacity-0'}`}>
                                {item.label}
                              </span>
                            </>
                          )}
                        </NavLink>
                      )}
                      {item.children && showText ? (
                        <div
                          className={`ml-6 overflow-hidden border-l border-[#dbe6ef] pl-4 transition-all duration-300 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none ${
                            childOpen ? 'mt-1 max-h-[280px] opacity-100' : 'mt-0 max-h-0 opacity-0'
                          }`}
                        >
                          <div className={`space-y-0.5 transition-transform duration-300 ease-[cubic-bezier(.2,.8,.2,1)] ${childOpen ? 'translate-y-0' : '-translate-y-2'}`}>
                            {item.children.map((child) => {
                              const ChildIcon = child.icon;
                              return (
                                <NavLink
                                  key={child.to}
                                  to={child.to}
                                  onClick={onNavigate}
                                  tabIndex={childOpen ? 0 : -1}
                                  className={({ isActive }) =>
                                    `flex h-8 items-center justify-start gap-2 rounded-lg px-2 text-left text-xs font-black transition-colors ${isActive
                                      ? 'bg-[#e7f7ff] text-[#0a5f86]'
                                      : 'text-[#63758c] hover:bg-[#f6fbff] hover:text-[#0a5f86]'
                                    }`
                                  }
                                >
                                  <ChildIcon size={14} />
                                  <span className="truncate text-left">{child.label}</span>
                                </NavLink>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="mt-auto border-t border-[#dbe6ef] pt-3">
          <div className={`mb-2 flex items-center gap-3 rounded-xl bg-[#f6fbff] p-2 ${showText ? 'justify-start' : 'justify-center'}`}>
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#03b0f7] text-sm font-black text-white shadow-[0_10px_22px_rgba(3,176,247,.22)]">
              {initial}
            </div>
            <div className={`min-w-0 overflow-hidden transition-all duration-300 ease-[cubic-bezier(.2,.8,.2,1)] ${showText ? 'max-w-[176px] opacity-100' : 'max-w-0 opacity-0'}`}>
              <div className="truncate text-sm font-black text-[#142033]">Drprepper</div>
              <div className="truncate text-xs font-semibold text-[#738399]">{email}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void auth.signOut().then(() => navigate('/login'))}
            className={`flex h-10 w-full items-center rounded-xl border border-[#dbe6ef] bg-white text-sm font-black text-[#34445a] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#e7f7ff] hover:text-[#0a5f86] active:translate-y-0 motion-reduce:transform-none ${showText ? 'justify-start gap-2 px-3' : 'justify-center px-0'
              }`}
            title={showText ? undefined : 'Sign out'}
          >
            <LogOut size={16} />
            <span className={`overflow-hidden whitespace-nowrap transition-all duration-300 ${showText ? 'max-w-[90px] opacity-100' : 'max-w-0 opacity-0'}`}>Sign out</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
