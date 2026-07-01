import { HoverZoomImage } from '@/components/ui/HoverZoomImage';
import type { PortalItemIdentity } from '@/lib/api';

const EMPTY_ITEM: PortalItemIdentity = { name: null, sku: null, quantity: null, imageUrl: null };

function visibleItems(items: PortalItemIdentity[] | null | undefined, limit: number): PortalItemIdentity[] {
  const source = items ?? [];
  return source.length ? source.slice(0, limit) : [EMPTY_ITEM];
}

export function ItemNameLines({ items, limit = 4 }: { items?: PortalItemIdentity[] | null; limit?: number }) {
  const total = items?.length ?? 0;
  return (
    <div className="space-y-1">
      {visibleItems(items, limit).map((item, index) => (
        <div key={`${item.sku ?? item.name ?? 'item'}-${index}`} className="flex min-w-0 items-center gap-2">
          <HoverZoomImage src={item.imageUrl} alt={item.name ?? ''} size={28} zoom={240} />
          <span className="min-w-0 flex-1 truncate text-ink-2" title={item.name ?? ''}>{item.name ?? '-'}</span>
          {Number(item.quantity) > 1 && (
            <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px] font-semibold text-ink-3">x{item.quantity}</span>
          )}
        </div>
      ))}
      {total > limit && <p className="text-[11px] text-ink-3">+{total - limit} more</p>}
    </div>
  );
}

export function SkuLines({ items, limit = 4 }: { items?: PortalItemIdentity[] | null; limit?: number }) {
  const total = items?.length ?? 0;
  return (
    <div className="space-y-1">
      {visibleItems(items, limit).map((item, index) => (
        <div key={`${item.sku ?? item.name ?? 'sku'}-${index}`} className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate font-mono text-[12px] text-ink-3" title={item.sku ?? ''}>{item.sku ?? '-'}</span>
          {Number(item.quantity) > 1 && (
            <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px] font-semibold text-ink-3">x{item.quantity}</span>
          )}
        </div>
      ))}
      {total > limit && <p className="text-[11px] text-ink-3">+{total - limit} more</p>}
    </div>
  );
}
