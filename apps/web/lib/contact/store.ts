'use client';

import { useCallback, useSyncExternalStore } from 'react';

import type { ContactRequest, ContactStatus } from './api';
import type { ContactRequestBody } from './validate';

/**
 * PREVIEW store for contact requests, off live: the browser's localStorage,
 * shared by the marketplace, the officer desk and the farmer's Home in this
 * browser, so the whole path — a buyer asks, the officer introduces, the
 * farmer sees it — can be walked before the routes exist. Nothing here is a
 * record; the route replaces it under NEXT_PUBLIC_USE_LIVE_CONTACT.
 */
const KEY = 'agri-contact-requests';
const listeners = new Set<() => void>();
let cache: ContactRequest[] | null = null;

function read(): ContactRequest[] {
  if (cache) return cache;
  try {
    const raw = typeof window === 'undefined' ? null : window.localStorage.getItem(KEY);
    cache = raw ? (JSON.parse(raw) as ContactRequest[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(next: ContactRequest[]): void {
  cache = next;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: the request still lives for this page.
  }
  listeners.forEach((l) => l());
}

const EMPTY: ContactRequest[] = [];
function subscribe(l: () => void): () => void {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cache = null;
      l();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(l);
    window.removeEventListener('storage', onStorage);
  };
}

export function usePreviewContactRequests(): {
  requests: ContactRequest[];
  add: (listingId: string, farmerId: string, body: ContactRequestBody) => ContactRequest;
  update: (id: string, status: Exclude<ContactStatus, 'new'>, note?: string, by?: string) => void;
} {
  const requests = useSyncExternalStore(subscribe, read, () => EMPTY);
  const add = useCallback((listingId: string, farmerId: string, body: ContactRequestBody) => {
    const row: ContactRequest = {
      id: crypto.randomUUID(),
      listing_id: listingId,
      farmer_id: farmerId,
      ...body,
      status: 'new',
      note: null,
      created_at: new Date().toISOString(),
      handled_at: null,
      handled_by: null,
    };
    write([row, ...read()]);
    return row;
  }, []);
  const update = useCallback(
    (id: string, status: Exclude<ContactStatus, 'new'>, note?: string, by?: string) => {
      write(
        read().map((r) =>
          r.id === id
            ? {
                ...r,
                status,
                note: note ?? r.note,
                handled_at: new Date().toISOString(),
                handled_by: by ?? r.handled_by,
              }
            : r,
        ),
      );
    },
    [],
  );
  return { requests, add, update };
}
