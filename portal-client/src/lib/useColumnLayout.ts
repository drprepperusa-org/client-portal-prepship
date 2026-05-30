import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

/**
 * Owns all column-layout state for <DataTable>: order, per-column width,
 * localStorage persistence, dynamic add/remove reconciliation, and a measured
 * minimum width per column so a title can never be hidden by resizing.
 *
 * Pages rebuild their `columns` array on every render (new identity each time),
 * so everything keys off the column-KEY signature — not array identity — to
 * keep reorder/resize state stable across unrelated re-renders.
 */

export interface ColumnLayoutDef {
  key: string;
  /** Hard floor (px). The effective floor is max(this, measured title width). */
  minWidth?: number;
  /** Initial width (px) before any user resize. */
  defaultWidth?: number;
  resizable?: boolean;
  draggable?: boolean;
}

const DEFAULT_WIDTH = 160;
const BASE_MIN = 88;
const MAX_WIDTH = 640;
/** Header horizontal padding (px-4 = 32) + drag/resize affordance breathing room. */
const HEADER_CHROME = 44;
const STORAGE_VERSION = 'v1';

interface Persisted {
  order?: string[];
  widths?: Record<string, number>;
  hidden?: string[];
}

function storageKey(tableId: string) {
  return `prepship.tbl.${tableId}.${STORAGE_VERSION}`;
}

function load(tableId?: string): Persisted {
  if (!tableId) return {};
  try {
    const raw = localStorage.getItem(storageKey(tableId));
    return raw ? (JSON.parse(raw) as Persisted) : {};
  } catch {
    return {};
  }
}

function save(tableId: string | undefined, data: Persisted) {
  if (!tableId) return;
  try {
    localStorage.setItem(storageKey(tableId), JSON.stringify(data));
  } catch {
    /* quota / disabled storage — non-fatal, layout just won't persist */
  }
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/**
 * Keep the user's order while tolerating columns being added or removed:
 * preserve known keys in their saved order, append brand-new keys, drop gone ones.
 */
function reconcileOrder(saved: string[], keys: string[]): string[] {
  const valid = new Set(keys);
  const kept = saved.filter((k) => valid.has(k));
  const missing = keys.filter((k) => !kept.includes(k));
  return [...kept, ...missing];
}

export interface ColumnLayout {
  order: string[];
  /** Order with hidden columns removed — what the table actually renders. */
  visibleOrder: string[];
  hidden: string[];
  toggleHidden: (key: string) => void;
  widthOf: (key: string) => number;
  totalWidth: number;
  setWidth: (key: string, px: number) => void;
  reorder: (dragKey: string, targetKey: string) => void;
  registerHeaderRef: (key: string) => (el: HTMLElement | null) => void;
  resetLayout: () => void;
  isCustomized: boolean;
  defByKey: Record<string, ColumnLayoutDef>;
}

export function useColumnLayout(tableId: string | undefined, columns: ColumnLayoutDef[]): ColumnLayout {
  const keys = useMemo(() => columns.map((c) => c.key), [columns]);
  const keysSig = keys.join('|');

  const defByKey = useMemo(() => {
    const m: Record<string, ColumnLayoutDef> = {};
    for (const c of columns) m[c.key] = c;
    return m;
  }, [columns]);

  // ---- order ----
  const [order, setOrder] = useState<string[]>(() => {
    const saved = load(tableId).order;
    return saved ? reconcileOrder(saved, keys) : keys;
  });

  // Reconcile whenever the set of columns changes (add/remove/dynamic columns).
  useEffect(() => {
    setOrder((prev) => {
      const next = reconcileOrder(prev, keys);
      return next.length === prev.length && next.every((k, i) => k === prev[i]) ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysSig]);

  // ---- widths (user overrides only; unset keys fall back to default) ----
  const [widths, setWidths] = useState<Record<string, number>>(() => load(tableId).widths ?? {});

  // ---- hidden columns ----
  const [hidden, setHidden] = useState<string[]>(() => (load(tableId).hidden ?? []).filter((k) => keys.includes(k)));

  // Drop hidden keys that no longer exist when columns change.
  useEffect(() => {
    setHidden((prev) => {
      const next = prev.filter((k) => keys.includes(k));
      return next.length === prev.length ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysSig]);

  const toggleHidden = useCallback((key: string) => {
    setHidden((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }, []);

  // ---- measured minimum widths (intrinsic title width) ----
  const [floors, setFloors] = useState<Record<string, number>>({});
  const headerEls = useRef<Record<string, HTMLElement | null>>({});

  const registerHeaderRef = useCallback(
    (key: string) => (el: HTMLElement | null) => {
      headerEls.current[key] = el;
    },
    [],
  );

  // Measure each title's intrinsic width after layout; this is the resize floor.
  useLayoutEffect(() => {
    const measured: Record<string, number> = {};
    for (const key of keys) {
      const el = headerEls.current[key];
      if (el) measured[key] = Math.ceil(el.scrollWidth) + HEADER_CHROME;
    }
    setFloors((prev) => {
      const changed = keys.some((k) => prev[k] !== measured[k]);
      return changed ? { ...prev, ...measured } : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysSig]);

  const effectiveMin = useCallback(
    (key: string) => Math.max(defByKey[key]?.minWidth ?? BASE_MIN, floors[key] ?? 0),
    [defByKey, floors],
  );

  const widthOf = useCallback(
    (key: string) => {
      const raw = widths[key] ?? defByKey[key]?.defaultWidth ?? DEFAULT_WIDTH;
      return clamp(raw, effectiveMin(key), MAX_WIDTH);
    },
    [widths, defByKey, effectiveMin],
  );

  const setWidth = useCallback(
    (key: string, px: number) => {
      setWidths((prev) => ({ ...prev, [key]: clamp(px, effectiveMin(key), MAX_WIDTH) }));
    },
    [effectiveMin],
  );

  const reorder = useCallback((dragKey: string, targetKey: string) => {
    if (dragKey === targetKey) return;
    setOrder((prev) => {
      const next = prev.filter((k) => k !== dragKey);
      const idx = next.indexOf(targetKey);
      if (idx === -1) return prev;
      next.splice(idx, 0, dragKey);
      return next;
    });
  }, []);

  const resetLayout = useCallback(() => {
    setWidths({});
    setOrder(keys);
    setHidden([]);
    save(tableId, {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysSig, tableId]);

  // Persist on change.
  useEffect(() => {
    save(tableId, { order, widths, hidden });
  }, [tableId, order, widths, hidden]);

  const visibleOrder = useMemo(() => order.filter((k) => !hidden.includes(k)), [order, hidden]);

  const totalWidth = useMemo(() => visibleOrder.reduce((sum, k) => sum + widthOf(k), 0), [visibleOrder, widthOf]);

  const isCustomized = useMemo(
    () => Object.keys(widths).length > 0 || hidden.length > 0 || order.join('|') !== keysSig,
    [widths, hidden, order, keysSig],
  );

  return {
    order,
    visibleOrder,
    hidden,
    toggleHidden,
    widthOf,
    totalWidth,
    setWidth,
    reorder,
    registerHeaderRef,
    resetLayout,
    isCustomized,
    defByKey,
  };
}
