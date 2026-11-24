import { useCallback, useEffect, useState } from 'react';

interface UseHiddenColumnsApi {
  hiddenCols: Set<string>;
  toggle: (key: string) => void;
  showAll: () => void;
}

// Persists a column-visibility hidden-set in localStorage under `storageKey`.
// Used by list pages that mirror the CandidateList "Колонки" popover pattern.
// Safe on SSR — returns an empty set until window is available.
export function useHiddenColumns(storageKey: string): UseHiddenColumnsApi {
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = window.localStorage.getItem(storageKey);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify([...hiddenCols]));
    } catch {
      // localStorage quota / sandbox — silently degrade.
    }
  }, [hiddenCols, storageKey]);

  const toggle = useCallback((key: string) => {
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const showAll = useCallback(() => setHiddenCols(new Set()), []);

  return { hiddenCols, toggle, showAll };
}
