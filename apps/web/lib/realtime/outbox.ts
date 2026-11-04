import { AsyncLocalStorage } from 'node:async_hooks';

import { after } from 'next/server';

import type { PushNote } from '../push/plan';
import { publishRealtime, type RealtimeEvent } from './publish';

/**
 * THE REQUEST'S REALTIME OUTBOX (2026-10-26).
 *
 * Code that stores something worth a live update -- a notice, a message --
 * calls `emitRealtime` from inside its transaction. The event is NOT sent
 * then: it waits here until the route's handler has returned, i.e. after the
 * transaction committed, and is published after the answer has gone. So a
 * screen that reacts to the event always finds the row, a rolled-back change
 * publishes nothing (the handler threw), and no request waits for Bird.
 *
 * Outside a request (a cron job, a script) there is no outbox, and the event
 * is published at once, in the background.
 *
 * 2026-11-03: phone alerts leave the same way (lib/push). Every event here can
 * become an alert; `emitPush` adds a notice that has no live event.
 */

const storage = new AsyncLocalStorage<{ events: RealtimeEvent[]; notes: PushNote[] }>();

/** Loaded when an alert is due, so a route that sends none never loads the push library. */
const sendPushes = async (events: readonly RealtimeEvent[], notes: readonly PushNote[]) =>
  (await import('../push/send')).sendPushes(events, notes);

export function emitRealtime(event: RealtimeEvent): void {
  if (event.channels.length === 0) return;
  const outbox = storage.getStore();
  if (outbox) outbox.events.push(event);
  else {
    void publishRealtime([event]);
    void sendPushes([event], []);
  }
}

export function emitPush(note: PushNote): void {
  const outbox = storage.getStore();
  if (outbox) outbox.notes.push(note);
  else void sendPushes([], [note]);
}

/** Runs `fn` with an outbox, and returns what it queued with its result. */
export async function withRealtimeOutbox<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; events: RealtimeEvent[]; notes: PushNote[] }> {
  const events: RealtimeEvent[] = [];
  const notes: PushNote[] = [];
  const result = await storage.run({ events, notes }, fn);
  return { result, events, notes };
}

/** Runs `task` after the response when the runtime allows it; otherwise in the background. */
export function afterResponse(task: () => Promise<unknown>): void {
  const run = () =>
    task().then(
      () => undefined,
      () => undefined,
    );
  try {
    after(run);
  } catch {
    // Outside a request scope (a script, a test): run without waiting.
    void run();
  }
}

/** Publishes what a request queued, after its answer. Never throws. */
export function flushRealtime(
  events: readonly RealtimeEvent[],
  notes: readonly PushNote[] = [],
): void {
  if (events.length > 0) afterResponse(() => publishRealtime(events));
  if (events.length > 0 || notes.length > 0) afterResponse(() => sendPushes(events, notes));
}
