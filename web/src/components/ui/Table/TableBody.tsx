import React, { ReactNode } from 'react';
import { type Table, flexRender } from '@tanstack/react-table';
import { Inbox } from 'lucide-react';
import { TableSkeleton } from './TableSkeleton';

interface TableBodyProps<TData> {
  table: Table<TData>;
  loading?: boolean;
  skeletonRows?: number;
  onRowClick?: (row: TData) => void;
  emptyMessage?: string | ReactNode;
}

export function TableBody<TData>({
  table,
  loading,
  skeletonRows,
  onRowClick,
  emptyMessage = 'No data available',
}: TableBodyProps<TData>) {
  const rows = table.getRowModel().rows;
  const colCount = table.getVisibleLeafColumns().length;

  if (loading) {
    return (
      <tbody className="divide-y divide-line/50 bg-white">
        <TableSkeleton table={table} rowCount={skeletonRows} />
      </tbody>
    );
  }

  if (rows.length === 0) {
    return (
      <tbody className="bg-white">
        <tr>
          <td colSpan={colCount} className="h-48 text-center align-middle">
            <div className="flex flex-col items-center justify-center text-ink-3 animate-fadeIn">
              <div className="grid h-12 w-12 place-items-center rounded-full bg-surface-2 mb-3">
                <Inbox size={24} strokeWidth={1.5} />
              </div>
              <p className="text-[14px] font-medium text-ink-2">
                {emptyMessage}
              </p>
            </div>
          </td>
        </tr>
      </tbody>
    );
  }

  return (
    <tbody className="divide-y divide-line/50 bg-white">
      {rows.map((row) => (
        <tr
          key={row.id}
          className={`group transition-colors duration-200 hover:bg-brand/5 ${onRowClick ? 'cursor-pointer focus-within:bg-brand/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/35' : ''}`}
          role={onRowClick ? 'button' : undefined}
          tabIndex={onRowClick ? 0 : undefined}
          onClick={() => onRowClick?.(row.original)}
          onKeyDown={(event) => {
            if (!onRowClick) return;
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onRowClick(row.original);
            }
          }}
        >
          {row.getVisibleCells().map((cell) => (
            <td
              key={cell.id}
              className="truncate px-4 py-3 text-[13.5px] text-ink transition-all group-hover:text-ink"
              style={{
                width: cell.column.getSize(),
                maxWidth: cell.column.getSize(),
                minWidth: cell.column.columnDef.minSize,
              }}
              title={typeof cell.getValue() === 'string' ? cell.getValue() as string : undefined}
            >
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}
