'use client';

import { dbFor } from './db';
import { currentAccount } from './outbox';

/**
 * A SCREEN'S LAST COPY (2026-10-10, PWA step 2), so it can be shown offline.
 *
 * `load` asks the server; with an answer it saves it on the phone and returns
 * it, fresh. With no signal it returns the copy saved last time, with when it
 * was saved, so the screen can say "Saved 10:42". Per account; cleared at
 * sign-out. Used by the farmer and officer screens from steps 3 and 4.
 */
export interface Snapshot<T> {
  data: T;
  savedAt: number;
  fresh: boolean;
}

export async function loadWithSnapshot<T>(
  key: string,
  load: () => Promise<T>,
): Promise<Snapshot<T> | null> {
  const account = currentAccount();
  try {
    const data = await load();
    if (account) await dbFor(account).cache.put({ key, data, savedAt: Date.now() });
    return { data, savedAt: Date.now(), fresh: true };
  } catch (failure) {
    if (!account) throw failure;
    const kept = await dbFor(account).cache.get(key);
    if (!kept) throw failure;
    return { data: kept.data as T, savedAt: kept.savedAt, fresh: false };
  }
}

/** Replace a saved copy (after an offline change, so the screen shows it at once). */
export async function saveSnapshot<T>(key: string, data: T): Promise<void> {
  const account = currentAccount();
  if (account) await dbFor(account).cache.put({ key, data, savedAt: Date.now() });
}

export async function readSnapshot<T>(key: string): Promise<Snapshot<T> | null> {
  const account = currentAccount();
  if (!account) return null;
  const kept = await dbFor(account).cache.get(key);
  return kept ? { data: kept.data as T, savedAt: kept.savedAt, fresh: false } : null;
}
