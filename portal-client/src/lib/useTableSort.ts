import { useState } from 'react';
import type { SortState } from '@/components/ui/data-table/types';

/** Keep server sort intent above the loading table; a new sort starts on page 1. */
export function useTableSort(onPage: (page: number) => void) {
  const [sort, setSort] = useState<SortState>(null);
  return {
    sort,
    onSortChange: (next: SortState) => { setSort(next); onPage(1); },
    sortBy: sort?.key,
    sortDir: sort?.dir,
  };
}
