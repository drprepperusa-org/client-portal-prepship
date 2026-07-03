import { NavLink, useLocation } from 'react-router-dom';
import { Menu, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { NAV } from '@/nav';
import { useAwaitingCount } from '@/lib/hooks';
import { prefetchRoute } from '@/lib/routePrefetch';

// Native-app style bottom tab bar for phones/tablets (hidden at lg+, where the
// sidebar takes over). Shows the primary client destinations; everything else
// lives behind "More" (the full sidebar drawer).
const PRIMARY_ROUTES = ['/', '/orders', '/shipments', '/billing'] as const;
const PRIMARY = PRIMARY_ROUTES.map((to) => NAV.find((n) => n.to === to)).filter(
  (n): n is (typeof NAV)[number] => Boolean(n),
);

function isActive(to: string, pathname: string): boolean {
  return to === '/' ? pathname === '/' : pathname.startsWith(to);
}

function Tab({
  to,
  label,
  icon: Icon,
  active,
  badge,
  onClick,
}: {
  to?: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  badge?: number;
  onClick?: () => void;
}) {
  const inner = (
    <>
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
    </>
  );
  const cls = 'focus-ring flex flex-1 flex-col items-center justify-center gap-0.5 rounded-lg py-1';
  return to ? (
    <NavLink to={to} onClick={onClick} onTouchStart={() => prefetchRoute(to)} aria-current={active ? 'page' : undefined} className={cls}>
      {inner}
    </NavLink>
  ) : (
    <button type="button" onClick={onClick} aria-label={label} className={cls}>
      {inner}
    </button>
  );
}

export function BottomNav({ onOpenMore }: { onOpenMore: () => void }) {
  const { pathname } = useLocation();
  const awaiting = useAwaitingCount().data?.count ?? 0;
  // "More" reads as active whenever the current page isn't one of the primary tabs.
  const moreActive = !PRIMARY.some((n) => isActive(n.to, pathname));
  return (
    <nav
      aria-label="Primary"
      className="glass-strong fixed inset-x-0 bottom-0 z-30 flex items-stretch gap-0.5 border-t border-white/60 px-1.5 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] lg:hidden"
    >
      {PRIMARY.map((item) => (
        <Tab
          key={item.to}
          to={item.to}
          label={item.label}
          icon={item.icon}
          active={isActive(item.to, pathname)}
          badge={item.to === '/orders' ? awaiting : 0}
        />
      ))}
      <Tab label="More" icon={Menu} active={moreActive} onClick={onOpenMore} />
    </nav>
  );
}
