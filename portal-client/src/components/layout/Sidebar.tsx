import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronLeft, PackageCheck, LogOut } from 'lucide-react';
import { cn } from '@/lib/cn';
import { NAV, type NavItem } from '@/nav';
import { AnimatedIcon } from '@/components/ui/AnimatedIcon';
import { Tooltip } from '@/components/ui/Display';
import { Avatar } from '@/components/ui/Display';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth';
import { useAwaitingCount, useMe } from '@/lib/hooks';
import { prefetchRoute } from '@/lib/routePrefetch';
import { portalApi } from '@/lib/api';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}

function Row({
  item,
  collapsed,
  onNavigate,
  onItemClick,
  badge,
}: {
  item: NavItem;
  collapsed: boolean;
  onNavigate?: () => void;
  onItemClick?: (item: NavItem) => void;
  badge?: number;
}) {
  const { pathname } = useLocation();
  const active = item.to === '/' ? pathname === '/' : pathname.startsWith(item.to);
  const showBadge = typeof badge === 'number' && badge > 0;
  const badgeText = showBadge ? (badge > 99 ? '99+' : String(badge)) : '';

  const link = (
    <NavLink
      to={item.to}
      onPointerDown={() => onItemClick?.(item)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onItemClick?.(item);
      }}
      onClick={onNavigate}
      onMouseEnter={() => prefetchRoute(item.to)}
      onFocus={() => prefetchRoute(item.to)}
      className={cn(
        'focus-ring group relative flex items-center gap-3 rounded-glass-sm px-3 py-2.5 text-sm font-medium transition-colors duration-200',
        collapsed && 'justify-center px-0',
        active ? 'text-ink' : 'text-ink-2 hover:text-ink',
      )}
    >
      {active && (
        <motion.span
          layoutId="nav-pill"
          transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          className="absolute inset-0 -z-0 rounded-glass-sm bg-white/80 shadow-glass ring-1 ring-white/70"
        />
      )}
      <span className="relative z-10">
        <AnimatedIcon icon={item.icon} accent={item.accent} active={active} size={19} />
        {/* Collapsed: show a dot on the icon so the badge is still visible. */}
        {collapsed && showBadge && <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-brand-500 ring-2 ring-white" />}
      </span>
      {!collapsed && <span className="relative z-10 truncate">{item.label}</span>}
      {!collapsed && showBadge && (
        <motion.span
          key={badgeText}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="relative z-10 ml-auto min-w-[20px] rounded-full bg-gradient-to-br from-brand-400 to-brand-600 px-1.5 py-0.5 text-center text-[11px] font-bold text-white tabular-nums shadow-[0_2px_6px_rgba(3, 169, 244,0.4)]"
        >
          {badgeText}
        </motion.span>
      )}
    </NavLink>
  );

  return collapsed ? (
    <Tooltip label={item.label} side="right">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

export function Sidebar({ collapsed, onToggle, onNavigate }: SidebarProps) {
  const nav = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { signOut, email, accessToken } = useAuth();
  const me = useMe();
  const isAdmin = me.data?.isAdmin ?? false;
  const displayName = email ? email.split('@')[0] : 'Account';
  const awaitingCount = useAwaitingCount().data?.count ?? 0;
  // Settings is admin-only — hide it from the rail for non-admins so the nav
  // mirrors the route guard (server also enforces admin scope).
  const navItems = isAdmin ? NAV : NAV.filter((item) => item.to !== '/settings' && item.to !== '/audit-log');

  function handleNavItemClick(item: NavItem) {
    if (!accessToken) return;
    void portalApi.auditClick(accessToken, { target: item.label, to: item.to, from: location.pathname }).catch(() => undefined);
  }

  async function handleLogout() {
    if (accessToken) {
      void portalApi.auditClick(accessToken, { target: 'Sign out', from: location.pathname }).catch(() => undefined);
    }
    await signOut();
    onNavigate?.();
    toast.info('Signed out', 'You have been logged out.');
    nav('/login', { replace: true });
  }

  return (
    <div className="glass-strong flex h-full flex-col rounded-glass">
      {/* Logo */}
      <div className={cn('flex items-center gap-2.5 px-4 py-5', collapsed && 'justify-center px-0')}>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-glass-sm bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-glass">
          <PackageCheck size={20} />
        </span>
        {!collapsed && (
          <div className="leading-tight">
            <p className="font-display text-[15px] font-bold tracking-tight text-ink">PrepShip</p>
            <p className="text-[11px] font-medium text-ink-3">Client Portal</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
        {navItems.map((item) => (
          <Row
            key={item.to}
            item={item}
            collapsed={collapsed}
            onNavigate={onNavigate}
            onItemClick={handleNavItemClick}
            badge={item.to === '/orders' ? awaitingCount : undefined}
          />
        ))}
      </nav>

      {/* Account block */}
      <div className="border-t border-white/60 p-3">
        {collapsed ? (
          <div className="flex flex-col items-center gap-2">
            <Avatar name={displayName} size={36} />
            <Tooltip label="Sign out" side="right">
              <button type="button" onClick={handleLogout} aria-label="Sign out" className="focus-ring grid h-9 w-9 cursor-pointer place-items-center rounded-lg text-ink-3 transition-colors hover:bg-rose-50 hover:text-rose-500">
                <LogOut size={17} />
              </button>
            </Tooltip>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-glass-sm p-2">
            <Avatar name={displayName} size={36} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold capitalize text-ink">{displayName}</p>
              <p className="truncate text-xs text-ink-3">{email ?? (isAdmin ? 'Administrator' : 'Client')}</p>
            </div>
            <button type="button" onClick={handleLogout} aria-label="Sign out" className="focus-ring cursor-pointer rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-rose-50 hover:text-rose-500">
              <LogOut size={17} />
            </button>
          </div>
        )}
      </div>

      {/* Collapse toggle (desktop only) */}
      <button
        onClick={onToggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="focus-ring absolute -right-3 top-20 hidden h-6 w-6 cursor-pointer place-items-center rounded-full bg-white text-ink-3 shadow-glass ring-1 ring-slate-200 transition-colors hover:text-brand-600 lg:grid"
      >
        <ChevronLeft size={14} className={cn('transition-transform duration-300', collapsed && 'rotate-180')} />
      </button>
    </div>
  );
}
