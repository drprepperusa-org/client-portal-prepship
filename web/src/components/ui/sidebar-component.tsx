import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Boxes,
  Calculator,
  LayoutDashboard,
  LogOut,
  PackagePlus,
  Plug,
  Receipt,
  Settings,
  ShoppingCart,
  TrendingUp,
  Truck,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { isPrepShipAdminEmail } from '../../lib/adminAccess';

export type SidebarNavItem = {
  to: string;
  label: string;
  description: string;
  group: string;
  icon: LucideIcon;
  end?: boolean;
  count?: string;
  shortcut?: string;
};

export const clientPortalNavItems: SidebarNavItem[] = [
  { to: '/dashboard', label: 'Overview', description: 'Operations command center', group: 'Operations', icon: LayoutDashboard, end: true, shortcut: '⌘1' },
  { to: '/dashboard/orders', label: 'Orders', description: 'Client-scoped order queue', group: 'Operations', icon: ShoppingCart },
  { to: '/dashboard/inbound', label: 'Inbound', description: 'Restock and receiving watch', group: 'Operations', icon: PackagePlus },
  { to: '/dashboard/shipments', label: 'Shipments', description: 'Tracking and label history', group: 'Operations', icon: Truck },
  { to: '/dashboard/inventory', label: 'Inventory', description: 'SKU stock visibility', group: 'Operations', icon: Boxes },
  { to: '/dashboard/analysis', label: 'Analysis', description: 'SKU trends and profitability', group: 'Intelligence', icon: TrendingUp },
  { to: '/dashboard/reports', label: 'Reports', description: 'Scoped operating trends', group: 'Intelligence', icon: BarChart3 },
  { to: '/dashboard/invoices', label: 'Invoices', description: 'Billing summaries', group: 'Finance', icon: Receipt },
  { to: '/dashboard/invoices/rate-sheet', label: 'Rate Sheet', description: 'Carrier rate matrix', group: 'Finance', icon: Calculator },
  { to: '/dashboard/connections', label: 'Connections', description: 'Marketplace credentials', group: 'System', icon: Plug },
  { to: '/dashboard/settings/system', label: 'Settings', description: 'Account, scope, and backfill', group: 'System', icon: Settings },
];

const NAV_GROUP_ORDER = ['Operations', 'Intelligence', 'Finance', 'System'] as const;
const ADMIN_GROUPS = new Set(['System']);

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
  onNavigate,
}: ClientPortalSidebarProps) {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const canSeeAdmin = isPrepShipAdminEmail(auth.user?.email);

  const groups = NAV_GROUP_ORDER
    .filter((group) => canSeeAdmin || !ADMIN_GROUPS.has(group))
    .map((group) => ({
      label: group,
      items: clientPortalNavItems.filter((item) => item.group === group),
    }))
    .filter((group) => group.items.length > 0);

  void location;

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-[70] flex h-screen w-[224px] flex-col border-r border-line bg-surface transition-transform duration-200 motion-reduce:transition-none ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      aria-label="Client portal navigation"
    >
      <div className="flex h-full min-h-0 flex-col px-2 py-3">
        {/* BRAND — Linear-style minimal */}
        <NavLink
          to="/dashboard"
          end
          onClick={onNavigate}
          className="mb-3 flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-surface-3"
          aria-label="PrepShip"
        >
          <div className="grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-ink">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden>
              <path d="M6 7l4 6 4-6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[14px] font-semibold tracking-[-0.01em] text-ink">PrepShip</div>
            <div className="truncate font-mono text-[9.5px] uppercase tracking-[0.16em] text-ink-3">Dr Prepper</div>
          </div>
        </NavLink>

        {/* NAV */}
        <nav className="portal-sidebar-scrollbarless min-h-0 flex-1 overflow-y-auto overflow-x-hidden" aria-label="Main navigation">
          {groups.map((group, idx) => (
            <div key={group.label} className={idx === 0 ? '' : 'mt-3'}>
              <div className="px-2 pb-1 pt-1 text-[11px] font-medium text-ink-3">{group.label}</div>
              <div className="flex flex-col gap-[1px]">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      `group flex h-[30px] items-center gap-2 rounded-md px-2 text-[13px] font-medium transition-colors ${
                        isActive
                          ? 'bg-surface-3 text-ink'
                          : 'text-ink-2 hover:bg-surface-3 hover:text-ink'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon
                          size={15}
                          strokeWidth={1.75}
                          className={isActive ? 'text-brand' : 'text-ink-3 group-hover:text-ink-2'}
                        />
                        <span className="truncate">{item.label}</span>
                        {item.shortcut ? (
                          <span className="ml-auto font-mono text-[10.5px] text-ink-3">{item.shortcut}</span>
                        ) : item.count ? (
                          <span className="ml-auto font-mono text-[10.5px] text-ink-3">{item.count}</span>
                        ) : null}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Sign out */}
        <button
          type="button"
          onClick={() => void auth.signOut().then(() => navigate('/login'))}
          className="mt-2 flex h-[30px] items-center gap-2 rounded-md px-2 text-[13px] font-medium text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink"
          aria-label="Sign out"
        >
          <LogOut size={15} strokeWidth={1.75} />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  );
}
