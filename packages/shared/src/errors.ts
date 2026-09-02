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
  conflict: 'conflict',
  payloadTooLarge: 'payload_too_large',
  unprocessable: 'unprocessable',
  internalError: 'internal_error',
} as const;

export const ERROR_MESSAGES = {
  invalidInput: 'Some of the information sent was not valid.',
  invalidJson: 'The request body could not be read.',
  invalidCursor: 'The page you asked for could not be found. Start again from the first page.',
  unauthenticated: 'Sign in to continue.',
  forbidden: 'You do not have permission to do this.',
  notFound: 'That record could not be found.',
  methodNotAllowed: 'That action is not available on this address.',
  conflict: 'That record has already been sent with different details.',
  payloadTooLarge: 'That request is too large to send.',
  /** Fixed sentence, never varied. CONVENTIONS.md section 5.2. */
  internalError: 'Something went wrong. Please try again.',
  unknownField: 'This field is not recognised.',
} as const;

/** The largest request body any route in B1.4 accepts. CONVENTIONS.md section 9. */
export const MAX_BODY_BYTES = 1_048_576;

/** Builds an error body with no `fields` key. */
export function apiError(code: string, message: string): ApiErrorBody {
  return { error: { code, message } };
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

    // A failure against the body as a whole has no field name of its own.
    record(path === '' ? 'body' : path, issue.message);
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
