/**
 * Shared validation.
 *
 * The API is the single source of validation truth: every request is validated
 * server-side against these schemas regardless of what a client did. See
 * docs/api/CONVENTIONS.md section 8.
 */

export { PHONE_MESSAGES, parseSouthSudanMobile, phoneSchema, type PhoneParseResult } from './phone';

export {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  PAGINATION_MESSAGES,
  paginationSchema,
  type Pagination,
} from './pagination';

export {
  apiError,
  ERROR_CODES,
  ERROR_MESSAGES,
  MAX_BODY_BYTES,
  REQUIRED_MEDIA_TYPE,
  isJsonMediaType,
  zodErrorToApiError,
  type ApiErrorBody,
} from './errors';

export { devValidatePhoneBodySchema } from './dev';
