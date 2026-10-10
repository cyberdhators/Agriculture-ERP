'use client';

import { dbFor, type OutboxRecord } from './db';
import { decideAnswer, decideNoAnswer, reasonFor } from './decide';
import { DEVICE_ID_HEADER, deviceId } from './device';

/**
 * THE OUTBOX ENGINE (2026-10-10, PWA step 2).
 *
 * Changes made on the phone are put here and sent when there is signal: one
 * record per request, in the order they were made, each with the id it was
 * made with so a retry is the same record (C-9). A record leaves the phone
 * only when the server acknowledges it; every other answer keeps it --
 * waiting to retry, waiting for sign-in, or stopped with the reason.
 *
 * The engine belongs to one signed-in account at a time (`setAccount`); with
 * no account, nothing is sent and nothing is queued.
 */

let account: string | null = null;
let running = false;
let needsSignIn = false;
let lastSyncAt: number | null = null;
const listeners = new Set<() => void>();

function changed(): void {
  for (const l of listeners) l();
}

export function subscribeOutbox(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Which account's outbox is active; null at sign-out. */
export function setAccount(authUserId: string | null): void {
  if (account === authUserId) return;
  account = authUserId;
  needsSignIn = false;
  changed();
  if (account) void syncNow();
}

export function currentAccount(): string | null {
  return account;
}

/**
 * The signed-in account, read from the saved session if the engine has not
 * been told yet -- a screen can load before OfflineSync starts. Works offline:
 * the session is read from this phone, not asked of the server.
 */
export async function ensureAccount(): Promise<string | null> {
  if (account) return account;
  try {
    const { supabaseBrowser } = await import('@/lib/supabase/browser');
    const { data } = await supabaseBrowser().auth.getSession();
    const id = data.session?.user.id ?? null;
    if (id) setAccount(id);
    return id;
  } catch {
    return null;
  }
}

export interface NewChange {
  id: string;
  label: string;
  kind: string;
  method: OutboxRecord['method'];
  path: string;
  body?: unknown;
  parentId?: string;
}

/**
 * Queue a change for the server. It is saved on the phone first; if there is
 * signal it is sent straight away. Returns false only if no account is active.
 */
export async function enqueue(change: NewChange): Promise<boolean> {
  await ensureAccount();
  if (!account) return false;
  const db = dbFor(account);
  const existing = await db.outbox.where('id').equals(change.id).first();
  const record: OutboxRecord = {
    ...change,
    status: 'pending',
    attempts: 0,
    nextAttemptAt: 0,
    createdAt: Date.now(),
  };
  if (existing?.seq !== undefined) {
    // The same record changed again before it was sent: send the latest.
    await db.outbox.update(existing.seq, { ...record, createdAt: existing.createdAt });
  } else {
    await db.outbox.add(record);
  }
  changed();
  void requestBackgroundSync();
  void syncNow();
  return true;
}

/** The person discards a stopped change. */
export async function discard(id: string): Promise<void> {
  if (!account) return;
  await dbFor(account).outbox.where('id').equals(id).delete();
  changed();
}

/** Try a stopped change again (after the person has fixed what was wrong elsewhere). */
export async function retry(id: string): Promise<void> {
  if (!account) return;
  await dbFor(account)
    .outbox.where('id')
    .equals(id)
    .modify({ status: 'pending', nextAttemptAt: 0, outcome: undefined, message: undefined });
  changed();
  void syncNow();
}

/** Ask Android to wake the app for a sync when signal returns, if it can. */
async function requestBackgroundSync(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.ready;
    const sync = (
      reg as ServiceWorkerRegistration & { sync?: { register(tag: string): Promise<void> } }
    )?.sync;
    await sync?.register('agrione-outbox');
  } catch {
    // Not supported or not permitted: the foreground triggers still sync.
  }
}

/**
 * Send what can be sent now. Single-flight: a second call while one runs is a
 * no-op. Stops at the first sign of no signal or trouble on the server, so a
 * queue never hammers a server that is down.
 */
export async function syncNow(): Promise<void> {
  if (running || !account || needsSignIn) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  running = true;
  changed();
  const db = dbFor(account);
  try {
    for (;;) {
      const now = Date.now();
      const next = await db.outbox
        .where('status')
        .equals('pending')
        .filter((r) => r.nextAttemptAt <= now)
        .sortBy('seq')
        .then((rows) => rows[0]);
      if (!next || next.seq === undefined) break;

      // A child waits for its parent (C-9.5): held until the parent is acknowledged.
      if (next.parentId && !(await db.acked.get(next.parentId))) {
        const parentQueued = await db.outbox.where('id').equals(next.parentId).count();
        if (parentQueued > 0) {
          await db.outbox.update(next.seq, {
            status: 'held',
            outcome: 'waiting_for_parent',
            message: reasonFor('waiting_for_parent'),
          });
          changed();
          continue;
        }
      }

      let res: Response;
      try {
        res = await fetch(next.path, {
          method: next.method,
          headers: {
            'content-type': 'application/json',
            [DEVICE_ID_HEADER]: deviceId(),
          },
          body: next.body === undefined ? undefined : JSON.stringify(next.body),
          signal: AbortSignal.timeout(45_000),
        });
      } catch {
        const d = decideNoAnswer(next.attempts, Date.now());
        await db.outbox.update(next.seq, {
          attempts: next.attempts + 1,
          nextAttemptAt: d.kind === 'retry' ? d.at : Date.now() + 60_000,
          outcome: 'retry_later',
        });
        break; // no signal: stop for now
      }

      const body = (await res.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string; fields?: Record<string, string> };
      };
      const d = decideAnswer({
        status: res.status,
        code: body.error?.code,
        retryAfter: res.headers.get('retry-after'),
        attempts: next.attempts,
        now: Date.now(),
      });

      if (d.kind === 'acked') {
        await db.transaction('rw', db.outbox, db.acked, async () => {
          await db.outbox.delete(next.seq!);
          await db.acked.put({ id: next.id, ackedAt: Date.now() });
          // Its children may go now.
          await db.outbox.where('parentId').equals(next.id).modify({
            status: 'pending',
            nextAttemptAt: 0,
            outcome: undefined,
            message: undefined,
          });
        });
        changed();
        continue;
      }
      if (d.kind === 'retry') {
        await db.outbox.update(next.seq, {
          attempts: next.attempts + 1,
          nextAttemptAt: d.at,
          outcome: d.outcome,
        });
        break; // the server is having trouble: stop for now
      }
      if (d.kind === 'reauth') {
        needsSignIn = true;
        await db.outbox.update(next.seq, { outcome: d.outcome, message: reasonFor(d.outcome) });
        break;
      }
      // stop: keep it, with the reason, for the person
      await db.outbox.update(next.seq, {
        status: 'stopped',
        attempts: next.attempts + 1,
        outcome: d.outcome,
        message: reasonFor(d.outcome, body.error?.message, body.error?.fields),
      });
      changed();
    }
    lastSyncAt = Date.now();
  } finally {
    running = false;
    changed();
  }
}

export interface OutboxSummary {
  account: string | null;
  waiting: number;
  stopped: OutboxRecord[];
  held: number;
  syncing: boolean;
  needsSignIn: boolean;
  lastSyncAt: number | null;
}

/** For the status indicator. */
export async function summary(): Promise<OutboxSummary> {
  const base = { account, syncing: running, needsSignIn, lastSyncAt };
  if (!account) return { ...base, waiting: 0, stopped: [], held: 0 };
  const db = dbFor(account);
  const [waiting, held, stopped] = await Promise.all([
    db.outbox.where('status').equals('pending').count(),
    db.outbox.where('status').equals('held').count(),
    db.outbox.where('status').equals('stopped').sortBy('seq'),
  ]);
  return { ...base, waiting, held, stopped };
}

/** The changes of one kind still on the phone (for screens to show "waiting to sync"). */
export async function queuedOf(kind: string): Promise<OutboxRecord[]> {
  await ensureAccount();
  if (!account) return [];
  return (await dbFor(account).outbox.toArray()).filter((r) => r.kind === kind);
}

/** After the person signs in again. */
export function signedInAgain(): void {
  needsSignIn = false;
  changed();
  void syncNow();
}
