import { useState } from 'react';

/** Reset request intent before a changed filter can fetch an obsolete page. */
export function useFilteredPage(filterKey: string) {
  const [state, setState] = useState({ filterKey, page: 1 });
  const changed = state.filterKey !== filterKey;
  if (changed) setState({ filterKey, page: 1 });
  return [changed ? 1 : state.page, (page: number) => setState({ filterKey, page })] as const;
}
