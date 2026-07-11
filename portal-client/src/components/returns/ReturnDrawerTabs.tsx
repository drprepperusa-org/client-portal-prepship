import { useRef, type KeyboardEvent } from 'react';
import { ClipboardCheck, History, Package } from 'lucide-react';
import { cn } from '@/lib/cn';

export type ReturnDrawerTab = 'overview' | 'inspection' | 'history';

const TABS = [
  { id: 'overview', label: 'Overview', icon: Package },
  { id: 'inspection', label: 'Inspection', icon: ClipboardCheck },
  { id: 'history', label: 'History', icon: History },
] as const;

export function ReturnDrawerTabs({ value, onChange }: {
  value: ReturnDrawerTab;
  onChange: (tab: ReturnDrawerTab) => void;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    else return;
    event.preventDefault();
    onChange(TABS[next].id);
    refs.current[next]?.focus();
  }

  return (
    <div className="grid grid-cols-3 gap-1 rounded-glass-sm bg-slate-100/90 p-1" role="tablist" aria-label="Return details">
      {TABS.map((tab, index) => {
        const active = value === tab.id;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            ref={(node) => { refs.current[index] = node; }}
            type="button"
            id={`return-tab-${tab.id}`}
            role="tab"
            aria-selected={active}
            aria-controls={`return-panel-${tab.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'focus-ring flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold transition-colors',
              active ? 'bg-white text-brand-700 shadow-sm' : 'text-ink-3 hover:bg-white/70 hover:text-ink',
            )}
          >
            <Icon size={15} aria-hidden /> {tab.label}
          </button>
        );
      })}
    </div>
  );
}
