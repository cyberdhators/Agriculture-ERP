import Dexie, { type Table } from 'dexie';

import type { SyncOutcome } from '@agri-erp/shared';

/**
 * THE ON-PHONE DATABASE (2026-10-10, PWA step 2) -- IndexedDB through Dexie.
 *
 * ONE DATABASE PER SIGNED-IN ACCOUNT, named by the account's sign-in id, so two
 * people on one phone never read each other's records. Two tables:
 *
 *   outbox -- changes made on this phone, waiting for the server. A record
 *             leaves only when the server acknowledges it (C-9); a refusal
 *             keeps it with the reason, for the person to fix or discard.
 *   cache  -- the last copy of screens the person may open offline (their
 *             listings, requests, caseload). Cleared at sign-out; the outbox
 *             is not, because unsent work is never thrown away.
 */

export type OutboxStatus = 'pending' | 'held' | 'stopped';

export interface OutboxRecord {
  /** Insertion order: records go to the server in the order they were made. */
  seq?: number;
  /** The record's own id, made on the phone (a retry is the same record). */
  id: string;
  /** What it is, for the person: "Post: Dry maize", "Accept request from Juba". */
  label: string;
  /** Which kind of change, for the screens that show pending work. */
  kind: string;
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  body?: unknown;
  /** A record that must reach the server first (a visit's farmer, say). */
  parentId?: string;
  status: OutboxStatus;
  outcome?: SyncOutcome | 'unexpected';
  /** The reason shown when stopped. */
  message?: string;
  attempts: number;
  /** Not before this time (ms). */
  nextAttemptAt: number;
  createdAt: number;
}

export interface CacheRecord {
  key: string;
  data: unknown;
  savedAt: number;
}

export interface AckRecord {
  id: string;
  ackedAt: number;
}

export class OfflineDb extends Dexie {
  outbox!: Table<OutboxRecord, number>;
  cache!: Table<CacheRecord, string>;
  /** Ids the server has acknowledged: a held child may now go. */
  acked!: Table<AckRecord, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      outbox: '++seq, &id, status, parentId, nextAttemptAt',
      cache: '&key',
      acked: '&id',
    });
  }
}

const PREFIX = 'agrione-offline-';
const open = new Map<string, OfflineDb>();

/** The database of one signed-in account. */
export function dbFor(authUserId: string): OfflineDb {
  let db = open.get(authUserId);
  if (!db) {
    db = new OfflineDb(PREFIX + authUserId);
    open.set(authUserId, db);
  }
  return db;
}

/** At sign-out: forget saved screens; keep unsent changes for when they sign in again. */
export async function clearCacheFor(authUserId: string): Promise<void> {
  await dbFor(authUserId).cache.clear();
}
