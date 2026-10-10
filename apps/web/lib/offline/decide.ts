import { SYNC_OUTCOME_SPECS, syncOutcomeFor, type SyncOutcome } from '@agri-erp/shared';

/**
 * WHAT TO DO WITH THE SERVER'S ANSWER (2026-10-10, PWA step 2).
 *
 * Pure: given one upload's result, the next state of that queued record. The
 * mapping is the C-9 contract in packages/shared/src/sync.ts -- the same one
 * the officer app was specified against -- so the server and the phone agree.
 *
 *   acked  -> the server has it; the phone may forget it
 *   retry  -> keep it; try again at `at`
 *   reauth -> keep it; the person must sign in again before anything sends
 *   stop   -> keep it; show `outcome`'s reason; only the person can resolve it
 */
export type Decision =
  | { kind: 'acked' }
  | { kind: 'retry'; at: number; outcome: SyncOutcome }
  | { kind: 'reauth'; outcome: SyncOutcome }
  | { kind: 'stop'; outcome: SyncOutcome | 'unexpected' };

/** Waits between tries when the server gives no Retry-After: 15 s doubling, at most 30 min. */
export function backoffMs(attempts: number): number {
  const base = 15_000 * 2 ** Math.max(0, attempts);
  return Math.min(base, 30 * 60_000);
}

/** Retry-After as seconds or an HTTP date; null when absent or unreadable. */
export function parseRetryAfter(value: string | null, now: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

/** No answer at all (no signal, DNS, the connection dropped): retry later. */
export function decideNoAnswer(attempts: number, now: number): Decision {
  return { kind: 'retry', at: now + backoffMs(attempts), outcome: 'retry_later' };
}

export function decideAnswer(input: {
  status: number;
  code?: string;
  retryAfter?: string | null;
  attempts: number;
  now: number;
}): Decision {
  const { status, code, attempts, now } = input;
  if (status >= 200 && status < 300) return { kind: 'acked' };
  const outcome = syncOutcomeFor(status, code);
  if (!outcome) return { kind: 'stop', outcome: 'unexpected' };
  const spec = SYNC_OUTCOME_SPECS[outcome];
  if (spec.action === 'retry') {
    const told = parseRetryAfter(input.retryAfter ?? null, now);
    const fallback = spec.retryAfterSeconds ? spec.retryAfterSeconds * 1000 : backoffMs(attempts);
    return { kind: 'retry', at: now + Math.max(told ?? 0, fallback, backoffMs(attempts)), outcome };
  }
  if (spec.action === 'reauthenticate') return { kind: 'reauth', outcome };
  return { kind: 'stop', outcome };
}

/** The sentence a person reads for a stopped record; a refusal shows the server's own reason. */
export function reasonFor(
  outcome: SyncOutcome | 'unexpected',
  serverMessage?: string,
  fields?: Record<string, string>,
): string {
  if (outcome === 'refused' || outcome === 'unexpected') {
    const detail = fields ? Object.values(fields).join(' ') : '';
    const text = [serverMessage, detail].filter(Boolean).join(' ');
    if (text) return text;
    return outcome === 'refused'
      ? SYNC_OUTCOME_SPECS.refused.message
      : 'The server did not accept this. Open it to check, or discard it.';
  }
  return SYNC_OUTCOME_SPECS[outcome].message;
}
