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

export const conflict = (message: string) => new ApiFailure(409, ERROR_CODES.conflict, message);

export const unprocessable = (message: string) =>
  new ApiFailure(422, ERROR_CODES.unprocessable, message);

/** The fixed sentence, every time. CONVENTIONS.md section 5.4. */
export const internalError = () =>
  new ApiFailure(500, ERROR_CODES.internalError, ERROR_MESSAGES.internalError);

export const failureResponse = (failure: ApiFailure, correlationId: string): NextResponse =>
  NextResponse.json(failure.body(), {
    status: failure.status,
    headers: { 'x-correlation-id': correlationId },
  });
