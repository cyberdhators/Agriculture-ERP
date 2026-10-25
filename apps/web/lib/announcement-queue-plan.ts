/**
 * HOW THE SCHEDULED ANNOUNCEMENT RUN SPENDS ITS TIME (2026-10-29). No
 * imports, so a pure test can read it; used by lib/api/announcement-queue.ts.
 *
 * One run is one serverless request (maxDuration 60 seconds). A batch stops
 * starting provider calls 30 seconds after it began and a provider call may
 * take 10 more, so a new batch is started only in the run's first
 * START_BUDGET_MS: the last one started then still ends inside the limit.
 */

/** Announcements looked at per run, oldest sent first. */
export const QUEUE_ANNOUNCEMENTS_PER_RUN = 20;

/** No batch is started after this much of the run has passed. */
export const QUEUE_START_BUDGET_MS = 12_000;

/** At most this many batches per run, however fast they are. */
export const QUEUE_MAX_BATCHES = 40;

export interface BatchCounts {
  in_app_sent: number;
  sms: { sent: number; failed: number; skipped: number };
  email: { sent: number; failed: number; skipped: number };
  interrupted_marked_failed: number;
}

/** Whether another batch may start, `elapsedMs` into the run with `batches` done. */
export function mayStartBatch(elapsedMs: number, batches: number): boolean {
  return elapsedMs < QUEUE_START_BUDGET_MS && batches < QUEUE_MAX_BATCHES;
}

/**
 * Whether a batch moved anything on. One that did nothing -- every remaining
 * delivery waits for a provider this deployment has not configured, or is
 * claimed by the screen's own batch -- is not asked again in this run.
 */
export function madeProgress(b: BatchCounts): boolean {
  return (
    b.in_app_sent +
      b.sms.sent +
      b.sms.failed +
      b.sms.skipped +
      b.email.sent +
      b.email.failed +
      b.email.skipped +
      b.interrupted_marked_failed >
    0
  );
}
