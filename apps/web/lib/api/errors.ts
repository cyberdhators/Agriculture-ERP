import { ERROR_CODES, ERROR_MESSAGES, type ApiErrorBody, apiError } from '@agri-erp/shared';
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

  constructor(
    status: number,
    code: string,
    publicMessage: string,
    fields?: Record<string, string>,
  ) {
    // The Error message is for our logs. It carries the code, never a name,
    // phone number or national id -- see the standing rule in PROJECT-STATE.md.
    super(`${status} ${code}`);
    this.name = 'ApiFailure';
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage;
    if (fields) this.fields = fields;
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
} as const;

export type RuleKey = keyof typeof RULE_MESSAGES;

/** A conflict, named by rule rather than by sentence. */
export const conflict = (rule: RuleKey) =>
  new ApiFailure(409, ERROR_CODES.conflict, RULE_MESSAGES[rule]);

/** A business rule refused it. The rule names itself; no free text enters. */
export const unprocessable = (rule: RuleKey) =>
  new ApiFailure(422, ERROR_CODES.unprocessable, RULE_MESSAGES[rule]);

/** An unreadable pagination cursor. CONVENTIONS section 6. */
export const invalidCursor = () =>
  new ApiFailure(400, ERROR_CODES.invalidCursor, ERROR_MESSAGES.invalidCursor);

/** The fixed sentence, every time. CONVENTIONS.md section 5.4. */
export const internalError = () =>
  new ApiFailure(500, ERROR_CODES.internalError, ERROR_MESSAGES.internalError);

export const failureResponse = (failure: ApiFailure, correlationId: string): NextResponse =>
  NextResponse.json(failure.body(), {
    status: failure.status,
    headers: { 'x-correlation-id': correlationId },
  });
