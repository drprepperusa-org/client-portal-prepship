import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type DragEvent, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GripVertical, RotateCcw, Columns3, Check, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { staggerContainer, staggerItem } from '@/lib/motion';
import { useColumnLayout } from '@/lib/useColumnLayout';

export interface Column<T> {
  key: string;
  header: string;
  /** Cell renderer. */
  render: (row: T) => ReactNode;
  className?: string;
  /** Hide column header label on mobile card layout. */
  mobileHidden?: boolean;
  /** Initial width in px (before any user resize). */
  defaultWidth?: number;
  /** Hard minimum width in px (the effective floor also respects the title width). */
  minWidth?: number;
  /** Allow resizing this column (default true). */
  resizable?: boolean;
  /** Allow drag-reordering this column (default true). */
  draggable?: boolean;
  /** Start hidden when column customization is enabled; user can show it. */
  defaultHidden?: boolean;
  /**
   * Makes the column sortable. Returns a comparable value for `row`. Numbers
   * sort numerically; strings use locale/numeric-aware compare; null/undefined
   * sort last. Omit to make the column non-sortable.
   */
  sortAccessor?: (row: T) => string | number | null | undefined;
  /**
   * Footer cell content for this column (e.g. a totals value). When any
   * column defines a footer, the table renders a totals row that follows the
   * live column order and visibility — so reordering or hiding columns keeps
   * every total under its own header.
   */
  footer?: ReactNode;
}

type SortState = { key: string; dir: 'asc' | 'desc' } | null;

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Optional per-row class (e.g. a status highlight). Merged onto the row
   *  element on both the desktop table rows and the mobile cards. */
  rowClassName?: (row: T) => string | undefined;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  /** Optional footer row(s) (e.g. a totals row), rendered in <tfoot>. */
  footer?: ReactNode;
  /** Initial sort (local mode only). */
  defaultSort?: SortState;
  /**
   * Controlled (server-side) sort. Provide `sort` + `onSortChange` TOGETHER for
   * whole-dataset sorting: the table renders `rows` as-is (they arrive already
   * sorted by the server for the full filtered set) and only surfaces the sort
   * indicator + reports header clicks. Omit both for the default local sort of
   * the current rows.
   */
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  /**
   * Stable id used to persist column order/width to localStorage. Omit to keep
   * customization in-memory only (resets on unmount).
   */
  tableId?: string;
  /**
   * CP-035: gate column customization (the Columns x/x chooser, Reset,
   * drag-to-reorder, and resize) behind an EXPLICIT opt-in. Defaults to false so
   * Client Portal customer tables are fixed — no toggling, and stale localStorage
   * layouts are ignored (a removed/hidden column can never resurrect). Admin/
   * internal surfaces may pass true, gated by role at the call site — never
   * inferred from tableId alone.
   */
  allowColumnCustomization?: boolean;
  /**
   * Stick the column header row to the top while the body scrolls (desktop only;
   * default off). The table's scroll wrapper is an overflow container (needed for
   * wide-table horizontal scroll), and page-level `position: sticky` can't reach
   * past an overflow ancestor — so enabling this also BOUNDS the wrapper height
   * (maxBodyHeight) to turn it into the vertical scroller the sticky header sticks
   * within. Short tables never hit the bound, so they render unchanged.
   */
  stickyHeader?: boolean;
  /** Max height of the scroll body when stickyHeader is on (any CSS length). */
  maxBodyHeight?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowClassName,
  onRowClick,
  empty,
  tableId,
  footer,
  defaultSort = null,
  sort: controlledSort,
  onSortChange,
  allowColumnCustomization = false,
  stickyHeader = false,
  maxBodyHeight = 'calc(100vh - 15rem)',
}: DataTableProps<T>) {
  // CP-035: customization (controls + drag/reorder/resize + persisted layout) is
  // enabled ONLY when a tableId is present AND the caller explicitly opts in.
  // When off, tableId is NOT passed to the layout hook, so persisted localStorage
  // order/width/hidden is ignored entirely — the table renders exactly the
  // columns it was given, in order, at their default widths.
  const customizable = Boolean(tableId) && allowColumnCustomization;
  const layout = useColumnLayout(customizable ? tableId : undefined, columns);
  const byKey = Object.fromEntries(columns.map((c) => [c.key, c])) as Record<string, Column<T>>;
  const ordered = layout.visibleOrder.map((k) => byKey[k]).filter(Boolean) as Column<T>[];

  // ---- Sorting ----
  // Controlled (server-sort) when a change handler is supplied: the parent owns
  // the sort and feeds `rows` already sorted for the FULL filtered set.
  const controlled = onSortChange != null;
  const [internalSort, setInternalSort] = useState<SortState>(defaultSort);
  const sort = controlled ? controlledSort ?? null : internalSort;
  function toggleSort(c: Column<T>) {
    if (!c.sortAccessor) return;
    let next: SortState;
    if (!sort || sort.key !== c.key) next = { key: c.key, dir: 'asc' };
    else if (sort.dir === 'asc') next = { key: c.key, dir: 'desc' };
    else next = controlled ? { key: c.key, dir: 'asc' } : null; // server: cycle asc↔desc; local: clear
    if (controlled) onSortChange(next);
    else setInternalSort(next);
  }
  const sortedRows = useMemo(() => {
    // Server-sort mode: rows already sorted for the whole filtered set — render
    // as-is, never re-sorting just the current page.
    if (controlled || !sort) return rows;
    const acc = columns.find((c) => c.key === sort.key)?.sortAccessor;
    if (!acc) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = acc(a);
      const vb = acc(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' }) * dir;
    });
  }, [rows, sort, columns, controlled]);

  // Columns visibility dropdown
  const [colsOpen, setColsOpen] = useState(false);
  const colsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (colsRef.current && !colsRef.current.contains(e.target as Node)) setColsOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  // ---- Resize (pointer-driven). Latest layout is read via a ref so the window
  // listeners stay stable for the whole drag even if `layout` re-renders. ----
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const resizing = useRef<{ key: string; startX: number; startW: number } | null>(null);

  const onResizeMove = useCallback((e: PointerEvent) => {
    const r = resizing.current;
    if (!r) return;
    layoutRef.current.setWidth(r.key, r.startW + (e.clientX - r.startX));
  }, []);

  const endResize = useCallback(() => {
    resizing.current = null;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    window.removeEventListener('pointermove', onResizeMove);
  }, [onResizeMove]);

  const startResize = useCallback(
    (key: string, e: ReactPointerEvent) => {
      // Stop the header's native drag from kicking in when grabbing the handle.
      e.preventDefault();
      e.stopPropagation();
      resizing.current = { key, startX: e.clientX, startW: layoutRef.current.widthOf(key) };
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
      window.addEventListener('pointermove', onResizeMove);
      window.addEventListener('pointerup', endResize, { once: true });
    },
    [onResizeMove, endResize],
  );

  // ---- Reorder (HTML5 drag-and-drop on headers) ----
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  function onHeaderDragStart(key: string, e: DragEvent) {
    if (resizing.current) {
      e.preventDefault();
      return;
    }
    setDragKey(key);
    e.dataTransfer.effectAllowed = 'move';
    // Some browsers require data to be set for the drag to initialize.
    try {
      e.dataTransfer.setData('text/plain', key);
    } catch {
      /* ignore */
    }
  }
  function onHeaderDragOver(key: string, e: DragEvent) {
    if (!dragKey || dragKey === key) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (overKey !== key) setOverKey(key);
  }
  function onHeaderDrop(key: string, e: DragEvent) {
    e.preventDefault();
    if (dragKey) layout.reorder(dragKey, key);
    setDragKey(null);
    setOverKey(null);
  }
  function onHeaderDragEnd() {
    setDragKey(null);
    setOverKey(null);
  }

  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <>
      {/* ---- Desktop / tablet: resizable + reorderable table ---- */}
      <div className="hidden md:block">
        {customizable && (
          <div className="flex items-center justify-end gap-2 px-1 pb-2">
            {layout.isCustomized && (
              <button
                onClick={layout.resetLayout}
                className="focus-ring inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-ink-3 transition-colors hover:bg-slate-100 hover:text-brand-600"
              >
                <RotateCcw size={13} /> Reset
              </button>
            )}
            {/* Columns visibility control */}
            <div className="relative" ref={colsRef}>
              <button
                onClick={() => setColsOpen((o) => !o)}
                className="focus-ring inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/80 bg-white/70 px-2.5 py-1.5 text-xs font-semibold text-ink-2 ring-1 ring-slate-200/70 transition-colors hover:bg-white"
              >
                <Columns3 size={14} /> Columns
                <span className="text-ink-3">
                  {layout.visibleOrder.length}/{layout.order.length}
                </span>
              </button>
              <AnimatePresence>
                {colsOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.98 }}
                    transition={{ duration: 0.14 }}
                    className="glass-strong absolute right-0 z-30 mt-2 max-h-80 w-60 overflow-auto rounded-glass-sm p-2 shadow-glass-lg"
                  >
                    <p className="px-2 pb-1.5 text-[11px] text-ink-3">Toggle visibility · drag headers to reorder · drag edge to resize</p>
                    {layout.order.map((k) => {
                      const col = byKey[k];
                      if (!col) return null;
                      const visible = !layout.hidden.includes(k);
                      // Don't allow hiding the final visible column.
                      const isLastVisible = visible && layout.visibleOrder.length === 1;
                      return (
                        <button
                          key={k}
                          onClick={() => !isLastVisible && layout.toggleHidden(k)}
                          disabled={isLastVisible}
                          className={cn(
                            'flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50',
                          )}
                        >
                          <span className={cn('grid h-4 w-4 place-items-center rounded border', visible ? 'border-brand-500 bg-gradient-to-br from-brand-400 to-brand-600' : 'border-slate-300 bg-white')}>
                            {visible && <Check size={11} className="text-white" strokeWidth={3.5} />}
                          </span>
                          <span className="text-ink-2">{col.header}</span>
                        </button>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}

        {/* Horizontal scroll so wide tables scroll instead of overlapping. When
            stickyHeader is on, this wrapper also becomes the VERTICAL scroller
            (bounded height) so the sticky <th> has a scroll container to stick
            within — page-level sticky can't reach past this overflow ancestor. */}
        <div
          className={cn('rounded-glass', stickyHeader ? 'overflow-auto' : 'overflow-x-auto')}
          style={stickyHeader ? { maxHeight: maxBodyHeight } : undefined}
        >
          <table className="border-collapse text-sm" style={{ width: layout.totalWidth, tableLayout: 'fixed' }}>
            <colgroup>
              {ordered.map((c) => (
                <col key={c.key} style={{ width: layout.widthOf(c.key) }} />
              ))}
            </colgroup>

            <thead>
              <tr className="border-b border-slate-200/70 text-left">
                {ordered.map((c) => {
                  const canDrag = customizable && c.draggable !== false;
                  const canResize = customizable && c.resizable !== false;
                  const isDragging = dragKey === c.key;
                  const isDropTarget = overKey === c.key && dragKey !== c.key;
                  return (
                    <th
                      key={c.key}
                      draggable={canDrag && !resizing.current}
                      onDragStart={(e) => canDrag && onHeaderDragStart(c.key, e)}
                      onDragOver={(e) => onHeaderDragOver(c.key, e)}
                      onDrop={(e) => onHeaderDrop(c.key, e)}
                      onDragEnd={onHeaderDragEnd}
                      onClick={() => toggleSort(c)}
                      aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                      className={cn(
                        'group select-none overflow-hidden px-4 py-3 text-xs font-semibold uppercase tracking-wide text-ink-3 transition-colors',
                        // `sticky` is itself a positioning context for the absolute
                        // drop-indicator / resize-handle children, so it replaces
                        // `relative`. The inset shadow is the header underline —
                        // border-collapse drops a sticky cell's real border on scroll.
                        stickyHeader
                          ? 'sticky top-0 z-20 bg-white/95 shadow-[inset_0_-1px_0_theme(colors.slate.200)]'
                          : 'relative',
                        canDrag ? 'cursor-grab active:cursor-grabbing' : c.sortAccessor && 'cursor-pointer',
                        sort?.key === c.key && 'text-brand-600',
                        isDragging && 'opacity-40',
                        isDropTarget && 'bg-brand-50/70',
                        c.className,
                      )}
                    >
                      {/* Drop indicator: a colored bar on the target's leading edge. */}
                      {isDropTarget && <span className="absolute inset-y-0 left-0 w-0.5 bg-brand-500" />}

                      <span className={cn('flex items-center gap-1', c.className?.includes('text-right') && 'justify-end')}>
                        {canDrag && (
                          <GripVertical
                            size={12}
                            className="shrink-0 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100"
                            aria-hidden
                          />
                        )}
                        {/* Measured for the min-width floor → titles never clip. */}
                        <span ref={layout.registerHeaderRef(c.key)} className="whitespace-nowrap">
                          {c.header}
                        </span>
                        {c.sortAccessor && (
                          <span className="shrink-0 text-slate-400">
                            {sort?.key === c.key ? (
                              sort.dir === 'asc' ? <ChevronUp size={12} className="text-brand-600" /> : <ChevronDown size={12} className="text-brand-600" />
                            ) : (
                              <ChevronsUpDown size={11} className="opacity-0 transition-opacity group-hover:opacity-50" />
                            )}
                          </span>
                        )}
                      </span>

                      {/* Resize handle on the trailing edge. */}
                      {canResize && (
                        <span
                          role="separator"
                          aria-orientation="vertical"
                          aria-label={`Resize ${c.header} column`}
                          onPointerDown={(e) => startResize(c.key, e)}
                          onClick={(e) => e.stopPropagation()}
                          draggable={false}
                          className="absolute right-0 top-0 z-10 flex h-full w-2 cursor-col-resize touch-none items-center justify-center"
                        >
                          <span className="h-1/2 w-px bg-slate-200 transition-colors group-hover:bg-slate-300" />
                          <span className="absolute inset-y-0 right-0 w-0.5 bg-transparent transition-colors hover:bg-brand-400" />
                        </span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>

            <motion.tbody variants={staggerContainer} initial="initial" animate="enter">
              {sortedRows.map((row) => (
                <motion.tr
                  key={rowKey(row)}
                  variants={staggerItem}
                  onClick={() => onRowClick?.(row)}
                  className={cn('border-b border-slate-100 transition-colors last:border-0 hover:bg-brand-50/50', onRowClick && 'cursor-pointer', rowClassName?.(row))}
                >
                  {ordered.map((c) => (
                    <td key={c.key} className={cn('overflow-hidden px-4 py-3.5 align-middle text-ink-2', c.className)}>
                      {c.render(row)}
                    </td>
                  ))}
                </motion.tr>
              ))}
            </motion.tbody>

            {ordered.some((c) => c.footer !== undefined) ? (
              // Column-aware totals row: follows the live column order and
              // visibility so every total stays under its own header.
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-white/40 font-bold text-ink">
                  {ordered.map((c) => (
                    <td key={c.key} className={cn('px-4 py-3', c.className)}>
                      {c.footer ?? null}
                    </td>
                  ))}
                </tr>
              </tfoot>
            ) : footer ? (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-white/40 font-bold text-ink">{footer}</tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>

      {/* ---- Mobile: stacked cards (honors column order; no resize needed) ---- */}
      <motion.div variants={staggerContainer} initial="initial" animate="enter" className="flex flex-col gap-3 md:hidden">
        {sortedRows.map((row) => (
          <motion.div
            key={rowKey(row)}
            variants={staggerItem}
            onClick={() => onRowClick?.(row)}
            className={cn('glass rounded-glass-sm p-4', onRowClick && 'cursor-pointer', rowClassName?.(row))}
          >
            {ordered.map((c) => (
              <div key={c.key} className="flex items-start justify-between gap-3 py-1.5 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-slate-100">
                {!c.mobileHidden && <span className="shrink-0 pt-0.5 text-xs font-semibold uppercase tracking-wide text-ink-3">{c.header}</span>}
                <div className={cn('min-w-0 text-right text-ink-2', c.mobileHidden ? 'w-full text-left' : 'flex-1')}>{c.render(row)}</div>
              </div>
            ))}
          </motion.div>
        ))}
      </motion.div>
    </>
  );
}
