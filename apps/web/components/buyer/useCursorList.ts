'use client';

import { useCallback, useEffect, useState } from 'react';

import type { Page } from '@/lib/buyer/api';

/**
 * One page of a cursor-paginated list, with Next and Previous.
 *
 * The API answers `{ cursor, hasMore }` and nothing else, so "Previous" is a
 * stack of the cursors already used -- there is no page number to jump to and
 * this does not invent one. `key` is whatever the list depends on (filters);
 * changing it starts again from the first page.
 */
export function useCursorList<T>(
  fetchPage: (cursor: string | null) => Promise<Page<T>>,
  key: string,
) {
  const [rows, setRows] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [back, setBack] = useState<Array<string | null>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // A new key is a new list: back to page one.
  useEffect(() => {
    setCursor(null);
    setBack([]);
  }, [key]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    fetchPage(cursor)
      .then((page) => {
        if (!live) return;
        setRows(page.rows);
        setNext(page.cursor);
        setHasMore(page.hasMore);
        setError(null);
      })
      .catch((failure: unknown) => {
        if (!live) return;
        setError(failure instanceof Error ? failure.message : 'This list could not be loaded.');
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // fetchPage is rebuilt by its caller on every render; key and cursor are
    // what this list actually depends on, so they alone re-run it.
  }, [key, cursor, attempt]);

  const goNext = useCallback(() => {
    if (!next) return;
    setBack((stack) => [...stack, cursor]);
    setCursor(next);
  }, [next, cursor]);

  const goBack = useCallback(() => {
    setBack((stack) => {
      const copy = [...stack];
      const previous = copy.pop() ?? null;
      setCursor(previous);
      return copy;
    });
  }, []);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { rows, loading, error, hasMore, canGoBack: back.length > 0, goNext, goBack, reload };
}
