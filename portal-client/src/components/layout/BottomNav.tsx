import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Plus, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { NAV } from '@/nav';
import { useAwaitingCount } from '@/lib/hooks';
import { prefetchRoute } from '@/lib/routePrefetch';

// Native-app style bottom tab bar for phones/tablets (hidden at lg+, where the
// sidebar takes over): two primary tabs, a raised center "+" create action,
// then two more tabs. Everything else stays reachable via the top-left menu
// (the full sidebar drawer).
const LEFT_ROUTES = ['/', '/orders'] as const;
const RIGHT_ROUTES = ['/shipments', '/billing'] as const;
const byRoute = (routes: readonly string[]) =>
  routes.map((to) => NAV.find((n) => n.to === to)).filter((n): n is (typeof NAV)[number] => Boolean(n));
const LEFT = byRoute(LEFT_ROUTES);
const RIGHT = byRoute(RIGHT_ROUTES);

function isActive(to: string, pathname: string): boolean {
  return to === '/' ? pathname === '/' : pathname.startsWith(to);
}

function Tab({ to, label, icon: Icon, active, badge }: {
  to: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  badge?: number;
}) {
  return (
    <NavLink
      to={to}
      onTouchStart={() => prefetchRoute(to)}
      aria-current={active ? 'page' : undefined}
      className="focus-ring flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg py-1"
    >
      <span className={cn('grid h-7 w-14 place-items-center rounded-full transition-colors', active && 'bg-brand-50')}>
        <span className="relative">
          <Icon size={20} strokeWidth={active ? 2.3 : 2} className={active ? 'text-brand-600' : 'text-ink-3'} />
          {badge != null && badge > 0 && (
            <span className="absolute -right-2.5 -top-1.5 min-w-[15px] rounded-full bg-gradient-to-br from-brand-400 to-brand-600 px-1 text-center text-[9px] font-bold leading-[15px] text-white shadow">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </span>
      </span>
      <span className={cn('max-w-full truncate text-[11px] font-medium', active ? 'text-brand-700' : 'text-ink-3')}>{label}</span>
    </NavLink>
  );
}

export function BottomNav() {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const awaiting = useAwaitingCount().data?.count ?? 0;
  return (
    <nav
      aria-label="Primary"
      className="glass-strong fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-white/60 px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] lg:hidden"
    >
      {LEFT.map((item) => (
        <Tab key={item.to} to={item.to} label={item.label} icon={item.icon} active={isActive(item.to, pathname)} badge={item.to === '/orders' ? awaiting : 0} />
      ))}

      {/* Raised center create action → New inbound (admin-gated on the page). */}
      <div className="flex flex-1 items-start justify-center">
        <button
          type="button"
          onClick={() => nav('/inbound?new=1')}
          onTouchStart={() => prefetchRoute('/inbound')}
          aria-label="New inbound"
          className="focus-ring -mt-5 grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-glass-lg ring-4 ring-white transition-transform active:scale-95"
        >
          <Plus size={26} strokeWidth={2.5} />
        </button>
      </div>

      {RIGHT.map((item) => (
        <Tab key={item.to} to={item.to} label={item.label} icon={item.icon} active={isActive(item.to, pathname)} />
      ))}
    </nav>
  );
}
