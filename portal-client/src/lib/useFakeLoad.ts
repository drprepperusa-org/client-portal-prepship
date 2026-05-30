import { useEffect, useState } from 'react';

/** Simulates an async data fetch so skeleton loaders are visible. */
export function useFakeLoad(ms = 650): boolean {
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setLoading(false), ms);
    return () => window.clearTimeout(t);
  }, [ms]);
  return loading;
}
