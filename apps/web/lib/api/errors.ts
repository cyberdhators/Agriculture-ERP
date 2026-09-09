import {
  ERROR_CODES,
  ERROR_MESSAGES,
  SYNC_OUTCOME_SPECS,
  type ApiErrorBody,
  apiError,
} from '@agri-erp/shared';
import { NextResponse } from 'next/server';

/**
 * A failure a route may throw, carrying the documented status and code.
 *
 * Routes throw these rather than returning them, so a check cannot be written
 * and then accidentally not returned -- `requireRole(...)` on its own line with
 * its result ignored still stops the request.
 */
export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  readonly publicMessage: string;
  readonly fields?: Record<string, string>;
  /** Extra response headers: Retry-After on a retryable outcome (C-9.15). */
  readonly headers?: Record<string, string>;

  constructor(
    status: number,
    code: string,
    publicMessage: string,
    fields?: Record<string, string>,
    headers?: Record<string, string>,
  ) {
    // The Error message is for our logs. It carries the code, never a name,
    // phone number or national id -- see the standing rule in PROJECT-STATE.md.
    super(`${status} ${code}`);
    this.name = 'ApiFailure';
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage;
    if (fields) this.fields = fields;
    if (headers) this.headers = headers;
  }

  body(): ApiErrorBody {
    if (this.fields) {
      return { error: { code: this.code, message: this.publicMessage, fields: this.fields } };
    }
    return apiError(this.code, this.publicMessage);
  }
}

export const unauthenticated = () =>
  new ApiFailure(401, ERROR_CODES.unauthenticated, ERROR_MESSAGES.unauthenticated);

export const forbidden = () => new ApiFailure(403, ERROR_CODES.forbidden, ERROR_MESSAGES.forbidden);

/**
 * Not found, soft-deleted, or outside the caller's scope -- one response for all
 * three. C-3.5 and CONVENTIONS.md section 5.1. Returning 403 for "exists but is
 * not yours" would confirm the record exists.
 */
export const notFound = () => new ApiFailure(404, ERROR_CODES.notFound, ERROR_MESSAGES.notFound);

/**
 * ============================================================================
 * PINNED BUSINESS-RULE SENTENCES. B3 opening task 5.
 * ============================================================================
 *
 * The standing rule is that an error message never interpolates a farmer's
 * name, phone number or national ID -- reference records by id. Until now that
 * was a discipline: `conflict(message)` and `unprocessable(message)` took any
 * string, which is exactly where an author writes
 * `could not register ${name}`.
 *
 * They now take a KEY from this registry instead. There is nowhere for
 * interpolation to go, because the function no longer accepts a sentence.
 *
 * Adding a rule means adding a line here, which is a deliberate act a reviewer
 * sees, rather than a template literal inside a route nobody reads again.
 *
 * CONVENTIONS section 5.2 says 422 has no generic sentence and each rule states
 * its own exact wording. This is where those live.
 */
export const RULE_MESSAGES = {
  phone_already_registered: 'That phone number is already registered to another officer.',
  account_already_exists: 'An account already exists for that address.',
  last_admin_cannot_be_removed:
    'This is the only administrator account. Create another administrator before removing this one.',
  last_admin_cannot_be_demoted:
    'This is the only administrator account. Create another administrator before changing this one.',
  cannot_remove_own_account: 'You cannot remove your own account.',
  cannot_change_own_role: 'You cannot change your own role.',
  payam_not_found: 'That payam could not be found.',
  state_not_found: 'That state could not be found.',
  // B5 (C-5). Every sentence names no person: a farmer is never described here.
  consent_required: 'Consent must be recorded before a farmer can be registered.',
  farmer_already_exists:
    'A farmer with that identifier has already been registered with different details. Open it and compare before sending again.',
  registering_officer_required: 'Name the extension officer who registered this farmer.',
  registering_officer_not_found: 'The registering officer could not be found in that payam.',
  // B6 (C-6). Decisions about a record, never words about a person.
  transition_not_allowed: 'That decision is not available for this record in its current state.',
  reason_required: 'A rejection must carry a reason.',
  merge_target_not_found: 'The farmer named as the original could not be found.',
  merge_target_not_eligible: 'The farmer named as the original cannot receive a merge.',
  merge_across_states: 'A farmer cannot be merged into a record in another state.',
  // B7 (C-7.2). Written for someone standing in a field, never the database's words.
  boundary_not_closed:
    'The boundary does not close: the last point must be the first point again. Go back to where you started and finish the shape.',
  boundary_crosses_itself:
    'The boundary crosses itself. Walk the edge of the plot in one direction without cutting across it.',
  boundary_too_few_points:
    'A boundary needs at least four corners. Keep walking to the next corner before you finish.',
  farm_already_exists:
    'A farm with that identifier has already been recorded with different details. Open it and compare before sending again.',
  boundary_already_exists:
    'A boundary with that identifier has already been recorded with different details. Open it and compare before sending again.',
  boundary_recorded_concurrently:
    'Another boundary was recorded for this farm and season at the same moment. Load the farm again before re-mapping.',
  // B8 (C-8). For an officer in a field: the action, never the fault (§14).
  visit_already_exists:
    'A visit with that identifier has already been recorded with different details. Open it and compare before sending again.',
  follow_up_not_found:
    "The earlier visit could not be found for this farmer. Choose it from this farmer's visits, or leave the link out.",
  follow_up_cycle:
    'That earlier visit already follows this one. Choose a visit from before it, or leave the link out.',
  correction_window_closed:
    'A day has passed since this visit was received. Ask an administrator to make the correction.',
  attachment_already_exists: 'An attachment with that identifier has already been declared.',
  attachment_not_arrived:
    'The file has not reached the server yet. Keep the phone on with signal and try again in a moment.',
  attachment_already_failed: 'This attachment did not send. Open the visit and send it again.',
  attachment_mismatch:
    'The file that arrived is not the one declared. Open the visit and send it again.',
  attachment_grant_expired: 'The upload took too long. Open the visit and send it again.',
  attachment_not_received:
    'This attachment has not been received, so there is nothing to open yet.',
  // B8.5 (C-8R). One sentence for missing, inactive and elsewhere: naming which would confirm an officer exists.
  reassign_officer_not_found:
    "No active officer with that identifier works in this farmer's payam. Choose one who does.",
  reassign_same_officer: 'This farmer is already with that officer. Nothing to change.',
} as const;

export type RuleKey = keyof typeof RULE_MESSAGES;

/** C-9.15: a retryable outcome says when. Seconds from the sync contract, never a guess per route. */
const retryAfter = (seconds: number | undefined): Record<string, string> | undefined =>
  seconds === undefined ? undefined : { 'retry-after': String(seconds) };

/**
 * A conflict, named by rule rather than by sentence. `attachment_not_arrived`
 * is the one 409 that means "not yet" rather than "never": it carries
 * Retry-After so the device knows when to confirm again (C-9.4, C-9.15).
 */
export const conflict = (rule: RuleKey) =>
  new ApiFailure(
    409,
    ERROR_CODES.conflict,
    RULE_MESSAGES[rule],
    undefined,
    rule === 'attachment_not_arrived'
      ? retryAfter(SYNC_OUTCOME_SPECS.not_yet.retryAfterSeconds)
      : undefined,
  );

/** A business rule refused it. The rule names itself; no free text enters. */
export const unprocessable = (rule: RuleKey) =>
  new ApiFailure(422, ERROR_CODES.unprocessable, RULE_MESSAGES[rule]);

/** An unreadable pagination cursor. CONVENTIONS section 6. */
export const invalidCursor = () =>
  new ApiFailure(400, ERROR_CODES.invalidCursor, ERROR_MESSAGES.invalidCursor);

/** The fixed sentence, every time. CONVENTIONS.md section 5.4. */
/**
 * B6.5: the sign-in service could not be consulted, so nothing is known about
 * the session. NOT 401 — "sign in to continue" would send an officer in the
 * field to re-enter credentials that were never wrong.
 */
export const authUnavailable = () =>
  new ApiFailure(
    503,
    ERROR_CODES.authUnavailable,
    ERROR_MESSAGES.authUnavailable,
    undefined,
    retryAfter(SYNC_OUTCOME_SPECS.retry_later.retryAfterSeconds),
  );
export const internalError = () =>
  new ApiFailure(
    500,
    ERROR_CODES.internalError,
    ERROR_MESSAGES.internalError,
    undefined,
    retryAfter(SYNC_OUTCOME_SPECS.retry_later.retryAfterSeconds),
  );

export const failureResponse = (failure: ApiFailure, correlationId: string): NextResponse =>
  NextResponse.json(failure.body(), {
    status: failure.status,
    headers: { ...failure.headers, 'x-correlation-id': correlationId },
  });
