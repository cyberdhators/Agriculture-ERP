import { AsyncLocalStorage } from 'node:async_hooks';

import { after } from 'next/server';

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
 */

const storage = new AsyncLocalStorage<RealtimeEvent[]>();

export function emitRealtime(event: RealtimeEvent): void {
  if (event.channels.length === 0) return;
  const outbox = storage.getStore();
  if (outbox) outbox.push(event);
  else void publishRealtime([event]);
}

/** Runs `fn` with an outbox, and returns what it queued with its result. */
export async function withRealtimeOutbox<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; events: RealtimeEvent[] }> {
  const events: RealtimeEvent[] = [];
  const result = await storage.run(events, fn);
  return { result, events };
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
export function flushRealtime(events: readonly RealtimeEvent[]): void {
  if (events.length === 0) return;
  afterResponse(() => publishRealtime(events));
}
