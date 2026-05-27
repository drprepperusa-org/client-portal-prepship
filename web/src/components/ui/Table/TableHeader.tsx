import React, { CSSProperties } from 'react';
import { type Table, type Header, flexRender } from '@tanstack/react-table';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, ArrowUpDown, GripVertical } from 'lucide-react';

interface SortableHeaderProps<TData> {
  header: Header<TData, unknown>;
}

function SortableHeader<TData>({ header }: SortableHeaderProps<TData>) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: header.column.id,
  });

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : 1,
    width: header.column.getSize(),
    minWidth: header.column.columnDef.minSize,
    maxWidth: header.column.getSize(),
  };

  const isSorted = header.column.getIsSorted();
  const canSort = header.column.getCanSort();
  
  return (
    <th
      ref={setNodeRef}
      style={style}
      className={`relative select-none border-b border-line bg-surface-2 px-4 py-3 text-left text-[12px] font-semibold text-ink-2 transition-colors first:rounded-tl-lg last:rounded-tr-lg
        ${isDragging ? 'shadow-lg bg-surface border-brand' : ''}
      `}
    >
      <div className="flex items-center gap-1.5">
        {/* Drag Handle */}
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          className="cursor-grab p-0.5 text-ink-4 outline-none hover:text-ink-2 focus-visible:ring-2 focus-visible:ring-brand active:cursor-grabbing"
          aria-label="Drag to reorder column"
        >
          <GripVertical size={14} />
        </button>

        {/* Header Content & Sort Toggle */}
        <div
          className={`flex flex-1 items-center gap-1 truncate ${
            canSort ? 'cursor-pointer hover:text-ink' : ''
          }`}
          onClick={header.column.getToggleSortingHandler()}
        >
          <span className="truncate">
            {flexRender(header.column.columnDef.header, header.getContext())}
          </span>
          
          {canSort && (
            <div className="flex shrink-0 text-ink-4 transition-colors">
              {isSorted === 'asc' ? (
                <ArrowUp size={14} className="text-brand" />
              ) : isSorted === 'desc' ? (
                <ArrowDown size={14} className="text-brand" />
              ) : (
                <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-100" />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Resize Handle */}
      {header.column.getCanResize() && (
        <div
          onMouseDown={header.getResizeHandler()}
          onTouchStart={header.getResizeHandler()}
          className={`absolute right-0 top-0 h-full w-2 cursor-col-resize touch-none select-none ${
            header.column.getIsResizing() ? 'bg-brand/50' : 'hover:bg-brand/30'
          }`}
        />
      )}
    </th>
  );
}

interface TableHeaderProps<TData> {
  table: Table<TData>;
}

export function TableHeader<TData>({ table }: TableHeaderProps<TData>) {
  return (
    <thead className="sticky top-0 z-10 shadow-[0_1px_0_var(--border-line)]">
      {table.getHeaderGroups().map((headerGroup) => (
        <tr key={headerGroup.id}>
          {headerGroup.headers.map((header) => (
            <SortableHeader key={header.id} header={header} />
          ))}
        </tr>
      ))}
    </thead>
  );
}
