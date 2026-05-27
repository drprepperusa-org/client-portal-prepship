import React from 'react';
import { type Table } from '@tanstack/react-table';

interface TableSkeletonProps<TData> {
  table: Table<TData>;
  rowCount?: number;
}

export function TableSkeleton<TData>({
  table,
  rowCount = 6,
}: TableSkeletonProps<TData>) {
  const columns = table.getVisibleLeafColumns();
  
  // Create an array of length `rowCount`
  const rows = Array.from({ length: rowCount }, (_, i) => i);

  return (
    <>
      {rows.map((rowIdx) => (
        <tr 
          key={`skeleton-row-${rowIdx}`} 
          className="border-b border-line/50 transition-colors last:border-0 hover:bg-brand/5"
        >
          {columns.map((column) => {
            return (
              <td
                key={`skeleton-col-${column.id}`}
                className="px-4 py-3"
                style={{
                  width: column.getSize(),
                  maxWidth: column.getSize(),
                  minWidth: column.columnDef.minSize,
                }}
              >
                <div className="flex h-5 w-full max-w-[80%] items-center overflow-hidden rounded bg-surface-3">
                  <div className="h-full w-full animate-shimmer bg-gradient-to-r from-surface-3 via-surface-2 to-surface-3 bg-[length:400%_100%]" />
                </div>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
