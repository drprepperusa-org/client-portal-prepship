import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
  mobileHidden?: boolean;
  defaultWidth?: number;
  minWidth?: number;
  resizable?: boolean;
  draggable?: boolean;
  defaultHidden?: boolean;
  sortAccessor?: (row: T) => string | number | null | undefined;
  footer?: ReactNode;
}

export type SortState = { key: string; dir: 'asc' | 'desc' } | null;

interface DataTableCommonProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowClassName?: (row: T) => string | undefined;
  empty?: ReactNode;
  footer?: ReactNode;
  defaultSort?: SortState;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  tableId?: string;
  allowColumnCustomization?: boolean;
  stickyHeader?: boolean;
  maxBodyHeight?: string;
}

export type DataTableProps<T> = DataTableCommonProps<T> & (
  | { onRowClick?: undefined; rowActionLabel?: never }
  | { onRowClick: (row: T) => void; rowActionLabel: (row: T) => string }
);
