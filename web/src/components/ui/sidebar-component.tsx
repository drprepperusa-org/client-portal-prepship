import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Boxes,
  Calculator,
  ChevronDown,
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
import { useAwaitingActiveOrderCountQuery } from '../../lib/portalQueries';

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
  const awaitingOrders = useAwaitingActiveOrderCountQuery(auth.accessToken);
  const awaitingShipmentCount = awaitingOrders.data?.count ?? 0;

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
          <div className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-[7px] bg-white shadow-sm ring-1 ring-line">
            <img src="/prepship-v4-logo.svg" alt="" className="h-5 w-5 object-contain" aria-hidden />
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[14px] font-semibold tracking-[-0.01em] text-ink">PrepShip</div>
            <div className="truncate font-mono text-[9.5px] uppercase tracking-[0.16em] text-ink-3">Dr Prepper</div>
          </div>
        </NavLink>

        {/* NAV */}
        <nav className="portal-sidebar-scrollbarless min-h-0 flex-1 overflow-y-auto overflow-x-hidden" aria-label="Main navigation">
          {groups.map((group, idx) => (
            <SidebarGroup
              key={group.label}
              group={group}
              idx={idx}
              onNavigate={onNavigate}
              awaitingShipmentCount={awaitingShipmentCount}
            />
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

function SidebarGroup({
  group,
  idx,
  onNavigate,
  awaitingShipmentCount,
}: {
  group: { label: string, items: SidebarNavItem[] };
  idx: number;
  onNavigate?: () => void;
  awaitingShipmentCount: number;
}) {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className={idx === 0 ? '' : 'mt-3'}>
      <button 
        type="button" 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-2 pb-1 pt-1 text-[11px] font-medium text-ink-3 hover:text-ink transition-colors"
      >
        <span>{group.label}</span>
        <motion.div
          animate={{ rotate: isOpen ? 0 : -90 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown size={14} />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex flex-col gap-[1px] overflow-hidden"
          >
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  `group flex h-[30px] items-center gap-2 rounded-md px-2 text-[13px] font-medium transition-colors ${
                    isActive
                      ? 'bg-brand/10 text-brand font-semibold'
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
                    {item.to === '/dashboard/orders' ? (
                      <span
                        className={`ml-auto rounded-full px-1.5 py-0.5 font-mono text-[10.5px] font-black ${
                          isActive ? 'bg-brand text-white' : 'bg-brand/10 text-brand'
                        }`}
                        aria-label={`${awaitingShipmentCount} awaiting shipment orders`}
                      >
                        {awaitingShipmentCount}
                      </span>
                    ) : item.shortcut ? (
                      <span className="ml-auto font-mono text-[10.5px] text-ink-3">{item.shortcut}</span>
                    ) : item.count ? (
                      <span className="ml-auto font-mono text-[10.5px] text-ink-3">{item.count}</span>
                    ) : null}
                  </>
                )}
              </NavLink>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
