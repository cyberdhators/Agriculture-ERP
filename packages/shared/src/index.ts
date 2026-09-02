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

export { REDACTED, isSensitiveKey, scrub, scrubEvent, scrubString } from './scrub';

export {
  LOCATION_MESSAGES,
  canonicaliseTree,
  countyRowSchema,
  locationCodeSchema,
  locationNameSchema,
  locationRowSchema,
  payamRowSchema,
  stateRowSchema,
  type CountyRow,
  type LocationRow,
  type LocationTree,
  type PayamRow,
  type StateRow,
} from './location';

export {
  DIRECTORY_ENTRY_TYPES,
  DIRECTORY_LIMITS,
  DIRECTORY_MESSAGES,
  FINANCIAL_PROVIDER_CLASSES,
  directoryEntryInputSchema,
  geoPointSchema,
  todayIso,
  type DirectoryEntryInput,
  type DirectoryEntryType,
  type FinancialProviderClass,
  type GeoPoint,
} from './directory';

export {
  CROPS,
  LANGUAGES,
  LEARNING_LIMITS,
  LEARNING_MESSAGES,
  LEARNING_TOPICS,
  RESOURCE_FORMATS,
  learningResourceInputSchema,
  type Crop,
  type Language,
  type LearningResourceInput,
  type LearningTopic,
  type ResourceFormat,
} from './learning';
