import { useEffect, useState } from 'react';

/** Typing is debounced; opening a saved view replaces draft and request intent together. */
export function useSearchDraft(initial = '') {
  const [search, setSearch] = useState(initial);
  const [appliedSearch, setAppliedSearch] = useState(initial);
  useEffect(() => {
    if (search === appliedSearch) return;
    const timer = window.setTimeout(() => setAppliedSearch(search), 350);
    return () => window.clearTimeout(timer);
  }, [search, appliedSearch]);
  function applySearch(value: string) {
    setSearch(value);
    setAppliedSearch(value);
  }
  return { search, setSearch, appliedSearch, applySearch };
}
