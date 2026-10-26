'use client';

import {
  type SavedSearch,
  type SavedSearchInput,
  savedSearchPatchSchema,
  savedSearchSchema,
} from '@agri-erp/shared';

/**
 * SAVED SEARCHES, THE PHONE'S SIDE (2026-11-03). One list per sign-in, read
 * and written through /api/account/saved-searches; the farmer side and the
 * buyer side share it. Inputs are checked with the shared schema before they
 * are sent, so the form and the route agree on what is valid.
 */

export class SavedSearchError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'SavedSearchError';
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      cache: 'no-store',
      ...init,
      headers: init.body ? { 'content-type': 'application/json' } : undefined,
    });
  } catch {
    throw new SavedSearchError(0, 'The server could not be reached. Check the connection.');
  }
  const body = (await res.json().catch(() => ({}))) as {
    data?: T;
    error?: { message?: string; fields?: Record<string, string> };
  };
  if (!res.ok) {
    throw new SavedSearchError(
      res.status,
      body.error?.message ?? `The request failed (${res.status}).`,
      body.error?.fields,
    );
  }
  return body.data as T;
}

const BASE = '/api/account/saved-searches';

export const listSavedSearches = () => call<SavedSearch[]>(BASE);

export function saveSearch(input: SavedSearchInput): Promise<SavedSearch> {
  const body = savedSearchSchema.parse(input);
  return call<SavedSearch>(BASE, { method: 'POST', body: JSON.stringify(body) });
}

export function setSearchPaused(id: string, paused: boolean): Promise<SavedSearch> {
  const body = savedSearchPatchSchema.parse({ paused });
  return call<SavedSearch>(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export const deleteSavedSearch = (id: string) =>
  call<{ id: string; deleted: true }>(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** The public state list (names and codes), for the form's state choice. */
export async function listStates(): Promise<{ id: string; name: string }[]> {
  return (await call<{ states: { id: string; name: string }[] }>('/api/locations/states')).states;
}
