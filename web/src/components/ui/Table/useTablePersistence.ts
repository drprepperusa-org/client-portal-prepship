import { useState, useEffect, useCallback } from 'react';

// Simplified debounce hook
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

export function useTablePersistence<T>(tableId: string, key: string, initialValue: T) {
  const fullKey = `table:${tableId}:${key}`;

  // Initialize from localStorage if possible
  const [state, setState] = useState<T>(() => {
    if (typeof window === 'undefined') return initialValue;
    try {
      const item = window.localStorage.getItem(fullKey);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.warn(`Error reading localStorage key "${fullKey}":`, error);
      return initialValue;
    }
  });

  const debouncedState = useDebounce(state, 300);

  // Sync to localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(fullKey, JSON.stringify(debouncedState));
    } catch (error) {
      console.warn(`Error setting localStorage key "${fullKey}":`, error);
    }
  }, [debouncedState, fullKey]);

  return [state, setState] as const;
}

export function resetTablePreferences(tableId: string) {
  if (typeof window === 'undefined') return;
  try {
    const keysToRemove = [
      `table:${tableId}:columnSizing`,
      `table:${tableId}:columnOrder`,
      `table:${tableId}:columnVisibility`,
      `table:${tableId}:pageSize`,
    ];
    keysToRemove.forEach((key) => window.localStorage.removeItem(key));
  } catch (error) {
    console.warn(`Error resetting preferences for table "${tableId}":`, error);
  }
}
