import { z } from 'zod';

/**
 * The sync contract (C-9): what the officer app is built against. The seven
 * outcomes a queued record can meet, each with the device's action and a
 * sentence for the officer (§14); the device header; the entities that sync.
 *
 * C-9.15: the device acts on every code without a follow-up read. Six are
 * server responses; waiting_for_parent is the device's own hold, decided from
 * whether the parent has been acknowledged, and the server never sends it.
 */

export const SYNC_ENTITIES = [
  'farmer',
  'farm',
  'farm_boundary',
  'crop_declaration',
  'visit',
  'visit_attachment',
] as const;
export type SyncEntity = (typeof SYNC_ENTITIES)[number];

export const SYNC_OUTCOMES = [
  'retry_later',
  'sign_in_again',
  'not_yet',
  'waiting_for_parent',
  'refused',
  'left_caseload',
  'conflict',
] as const;
export type SyncOutcome = (typeof SYNC_OUTCOMES)[number];

/** What the device does. `hold` means keep the record and wait for a local fact, not a timer. */
export type SyncAction = 'retry' | 'reauthenticate' | 'hold' | 'stop';

export interface SyncOutcomeSpec {
  readonly action: SyncAction;
  /** What the officer reads. The refused outcome shows the rule's own sentence instead. */
  readonly message: string;
  /** For retryable outcomes, the server also sends Retry-After with this many seconds. */
  readonly retryAfterSeconds?: number;
}

export const SYNC_OUTCOME_SPECS: Record<SyncOutcome, SyncOutcomeSpec> = {
  retry_later: {
    action: 'retry',
    message:
      'The server could not be reached. Your records are safe on this phone and will send when it can.',
    retryAfterSeconds: 60,
  },
  sign_in_again: {
    action: 'reauthenticate',
    message: 'Sign in again to keep sending. Nothing on this phone has been lost.',
  },
  not_yet: {
    action: 'retry',
    message: 'The file is still on its way. It will be checked again in a moment.',
    retryAfterSeconds: 10,
  },
  waiting_for_parent: {
    action: 'hold',
    message: 'This is waiting for the record it belongs to. It will send after that one.',
  },
  refused: {
    action: 'stop',
    message: 'This record was refused. Open it to see what to change.',
  },
  left_caseload: {
    action: 'stop',
    message:
      'This farmer is no longer in your caseload, so this cannot be sent. Ask your supervisor.',
  },
  conflict: {
    action: 'stop',
    message:
      'A record with this identifier already exists with different details. Open it and compare before sending again.',
  },
};

/**
 * How an HTTP outcome maps to a sync outcome, for the six the server produces.
 * The device applies this after its own hold (C-9.5): a 404 on a child whose
 * parent is not yet acknowledged is a device fault, not left_caseload.
 *
 * `rule` IS THE THIRD ARGUMENT BECAUSE IT HAD TO BE. This read
 * `code === 'attachment_not_arrived'`, and `code` on a 409 is always the
 * generic `conflict` -- the rule key stayed on the server. The branch could
 * never fire, so `not_yet` was unreachable and a device would have stopped
 * retrying an attachment whose bytes were merely still on their way. The key
 * now travels in the body as `error.rule` and is passed here.
 *
 * `code` is still accepted and still checked, so a caller that has not been
 * updated behaves exactly as before: every 409 is a conflict, which is the
 * safe reading when nothing better is known.
 */
export function syncOutcomeFor(status: number, code?: string, rule?: string): SyncOutcome | null {
  if (status === 401) return 'sign_in_again';
  if (status === 503 || status >= 500) return 'retry_later';
  if (status === 409 && (rule === 'attachment_not_arrived' || code === 'attachment_not_arrived')) {
    return 'not_yet';
  }
  if (status === 409) return 'conflict';
  if (status === 404) return 'left_caseload';
  if (status === 400 || status === 413 || status === 422) return 'refused';
  return null;
}

/** An opaque installation identifier the app generates once. Never the handset's hardware identity. */
export const DEVICE_ID_HEADER = 'x-device-id';
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;
export const deviceIdSchema = z.string().regex(DEVICE_ID_PATTERN);

/** The client id a create carries; a retry is the same request (C-9.2). */
export const SYNC_MESSAGES = {
  deviceIdShape: 'The device identifier is 8 to 64 letters, digits, dots, hyphens or underscores.',
} as const;
