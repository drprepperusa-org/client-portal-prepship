import { useMemo } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  STORE_PLATFORMS,
  STORE_PLATFORM_CATEGORIES,
  platformsByCategory,
  type StorePlatform,
} from '@/data/storePlatforms';
import { cn } from '@/lib/cn';
import { StoreLogo } from '../StoreLogo';
import type { StoreConnectFilter } from './types';

export function StorePlatformList({
  filter,
  onFilterChange,
  onChoose,
}: {
  filter: StoreConnectFilter;
  onFilterChange: (filter: StoreConnectFilter) => void;
  onChoose: (platform: StorePlatform) => void;
}) {
  const counts = useMemo(() => {
    const result: Record<string, number> = { all: STORE_PLATFORMS.length };
    for (const category of STORE_PLATFORM_CATEGORIES) {
      result[category] = platformsByCategory(category).length;
    }
    return result;
  }, []);
  const visible = platformsByCategory(filter);
  const rail: { key: StoreConnectFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    ...STORE_PLATFORM_CATEGORIES.map((category) => ({ key: category, label: category })),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
      <aside className="shrink-0 border-b border-white/60 p-3 sm:w-52 sm:border-b-0 sm:border-r">
        <div className="flex gap-1.5 overflow-x-auto sm:flex-col">
          {rail.map((item) => (
            <button
              key={item.key}
              onClick={() => onFilterChange(item.key)}
              className={cn(
                'focus-ring flex cursor-pointer items-center justify-between gap-2 whitespace-nowrap rounded-glass-sm px-3 py-2 text-sm font-semibold transition-colors',
                filter === item.key
                  ? 'bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-glass'
                  : 'text-ink-2 hover:bg-slate-100',
              )}
            >
              {item.label}
              <span className={cn(
                'rounded-full px-1.5 text-xs',
                filter === item.key ? 'bg-white/25' : 'bg-slate-200/70 text-ink-3',
              )}>
                {counts[item.key]}
              </span>
            </button>
          ))}
        </div>
      </aside>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-3">Supported Platforms</p>
          <span className="text-xs text-ink-3">{visible.length}</span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {visible.map((platform) => (
            <div
              key={platform.id}
              className="glass flex flex-col rounded-glass-sm p-4 ring-1 ring-white/60 transition-shadow hover:shadow-glass"
            >
              <div className="flex items-start gap-3">
                <StoreLogo platform={platform} />
                <div className="min-w-0 flex-1">
                  <h3 className="font-display text-[15px] font-bold text-ink">{platform.name}</h3>
                  <p className="mt-0.5 text-[13px] leading-snug text-ink-3">{platform.description}</p>
                  <p className="mt-1 text-xs text-ink-3/80">
                    {platform.credentialFields.length} required field
                    {platform.credentialFields.length === 1 ? '' : 's'}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-ink-3">
                  {platform.category}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  leadingIcon={<Plus size={15} />}
                  onClick={() => onChoose(platform)}
                >
                  Connect
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
