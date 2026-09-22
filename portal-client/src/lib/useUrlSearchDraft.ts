import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSearchDraft } from './useSearchDraft';

/** Adopt linked/back-forward search intent before committing a request for an old draft. */
export function useUrlSearchDraft() {
  const [params] = useSearchParams();
  const urlSearch = (params.get('q') ?? '').trim().slice(0, 120);
  const [previous, setPrevious] = useState(urlSearch);
  const draft = useSearchDraft(urlSearch);
  if (previous !== urlSearch) {
    setPrevious(urlSearch);
    draft.applySearch(urlSearch);
  }
  return draft;
}
