import type { ZodError } from 'zod';

/**
 * The single error shape, per docs/api/CONVENTIONS.md section 4.
 *
 * Clients branch on `code`, never on `message`. `fields` is present only on
 * validation errors, and is never present and empty.
 */

export interface ApiErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly fields?: Record<string, string>;
    /**
     * WHICH RULE REFUSED, for a caller that must act without reading the
     * sentence (C-9.15).
     *
     * `code` stays the generic `conflict` or `unprocessable` -- nothing about
     * the existing contract moves -- and this names the rule beside it. It is
     * the difference between a device knowing an attachment is still on its
     * way (`attachment_not_arrived`, retry soon) and treating it as a terminal
     * conflict (stop), which is what happened while the key never left the
     * server.
     *
     * ONLY EVER A KEY FROM THE PUBLISHED RULE LIST. It is not free text, not a
     * database error and not an internal name; the rules and their sentences
     * are already documented in CONVENTIONS.md section 5.
     */
    readonly rule?: string;
  };
}

/** Every error code this project defines. CONVENTIONS.md section 5. */
export const ERROR_CODES = {
  invalidInput: 'invalid_input',
  invalidJson: 'invalid_json',
  invalidCursor: 'invalid_cursor',
  unauthenticated: 'unauthenticated',
  forbidden: 'forbidden',
  notFound: 'not_found',
  methodNotAllowed: 'method_not_allowed',
  unsupportedMediaType: 'unsupported_media_type',
  conflict: 'conflict',
  payloadTooLarge: 'payload_too_large',
  unprocessable: 'unprocessable',
  internalError: 'internal_error',
  authUnavailable: 'auth_unavailable',
} as const;

export const ERROR_MESSAGES = {
  invalidInput: 'Some of the information sent was not valid.',
  invalidJson: 'The request body could not be read.',
  invalidCursor: 'The page you asked for could not be found. Start again from the first page.',
  unauthenticated: 'Sign in to continue.',
  forbidden: 'You do not have permission to do this.',
  notFound: 'That record could not be found.',
  methodNotAllowed: 'That action is not available on this address.',
  unsupportedMediaType: 'Send the request as application/json.',
  conflict: 'That record has already been sent with different details.',
  payloadTooLarge: 'That request is too large to send.',
  /** Fixed sentence, never varied. CONVENTIONS.md section 5.3. */
  internalError: 'Something went wrong. Please try again.',
  authUnavailable: 'The sign-in service could not be reached. Try again in a moment.',
  /**
   * `unprocessable` (422) deliberately has no entry here. Its sentence is
   * written by the business rule that rejected the request, because a generic
   * one would tell an officer nothing. Each rule states its own sentence when
   * it is built. CONVENTIONS.md section 5.2.
   */
  unknownField: 'This field is not recognised.',
  /**
   * Used for any failure against the body as a whole. Zod's own sentence for
   * this is "Invalid input: expected object, received string", which names
   * library concepts an extension officer has no use for. CONVENTIONS.md
   * section 4 forbids that register, so it never reaches a caller.
   */
  bodyNotExpectedForm: 'The request was not sent in the expected form.',
} as const;

/** The largest request body any route in B1.4 accepts. CONVENTIONS.md section 9.2. */
export const MAX_BODY_BYTES = 1_048_576;

/** The only media type a request with a body may use. CONVENTIONS.md section 9.1. */
export const REQUIRED_MEDIA_TYPE = 'application/json';

/**
 * True when a Content-Type header names JSON.
 *
 * Parameters such as `; charset=utf-8` are allowed and ignored; only the
 * media type itself is compared, case-insensitively. A missing header is
 * false: a body must say what it is.
 */
export function isJsonMediaType(headerValue: string | null): boolean {
  if (headerValue === null) return false;
  const mediaType = headerValue.split(';')[0]?.trim().toLowerCase() ?? '';
  return mediaType === REQUIRED_MEDIA_TYPE;
}

/** Builds an error body with no `fields` key. `rule` is omitted when absent. */
export function apiError(code: string, message: string, rule?: string): ApiErrorBody {
  return rule === undefined ? { error: { code, message } } : { error: { code, message, rule } };
}

/**
 * Converts any Zod failure into the documented validation error.
 *
 * Built against Zod 4's `error.issues` array. Zod 4 also offers
 * `z.treeifyError` and `z.flattenError`, and neither is used here: neither
 * produces the dot-with-array-index key that CONVENTIONS.md section 4.1
 * requires ("farm.area", "plots.0.name"). A future Zod upgrade should check
 * that `issues[].path` and the `unrecognized_keys` issue still behave as
 * assumed here -- the tests in errors.test.ts cover both.
 */
export function zodErrorToApiError(error: ZodError): {
  readonly status: 400;
  readonly body: ApiErrorBody;
} {
  const fields: Record<string, string> = {};

  const record = (key: string, message: string): void => {
    // First failure per field wins. One field, one sentence.
    if (!(key in fields)) {
      fields[key] = message;
    }
  };

  for (const issue of error.issues) {
    const path = issue.path.map((segment) => String(segment)).join('.');

    if (issue.code === 'unrecognized_keys') {
      // Zod reports unknown keys against the parent object, listing the names
      // separately. CONVENTIONS.md section 8.1 requires each one be named.
      for (const key of issue.keys) {
        record(path === '' ? key : `${path}.${key}`, ERROR_MESSAGES.unknownField);
      }
      continue;
    }

    if (path === '') {
      // A failure against the body as a whole has no field name of its own.
      // Zod's sentence for it is library vocabulary, so it is replaced. A
      // `custom` issue is one we wrote deliberately, so its message is kept.
      record('body', issue.code === 'custom' ? issue.message : ERROR_MESSAGES.bodyNotExpectedForm);
      continue;
    }

    record(path, issue.message);
  }

  return {
    status: 400,
    body: {
      error: {
        code: ERROR_CODES.invalidInput,
        message: ERROR_MESSAGES.invalidInput,
        fields,
      },
    },
  };
}
