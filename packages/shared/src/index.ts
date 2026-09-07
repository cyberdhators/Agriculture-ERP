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

export {
  ALL_ROLES,
  IDENTITY_MESSAGES,
  OFFICER_AUTH_DOMAIN,
  USER_ROLES,
  WRITING_ROLES,
  canWrite,
  createOfficerSchema,
  createUserSchema,
  officerAuthIdentifier,
  passwordSchema,
  patchOfficerSchema,
  patchUserSchema,
  personNameSchema,
  userRoleSchema,
  type CreateOfficer,
  type CreateUser,
  type PatchOfficer,
  type PatchUser,
  type Role,
  type Scope,
  type UserRole,
} from './identity';

/**
 * Re-exported so apps/web can type a schema without taking a direct dependency
 * on zod. This package owns the validation library; the app owns none of it.
 */
export type { ZodError, ZodType } from 'zod';

export { decodeCursor, encodeCursor, toIso, type Cursor } from './cursor';

export {
  AUDIT_ACTIONS,
  AUDIT_ACTOR_TYPES,
  auditFilterSchema,
  auditSafe,
  type AuditAction,
  type AuditActorType,
  type AuditFilter,
} from './audit';
export {
  FARMER_LIMITS,
  FARMER_MESSAGES,
  FARMER_NUMBER_PATTERN,
  NATIONAL_ID_PATTERN,
  REGISTRATION_SOURCES,
  SEXES,
  VERIFICATION_STATUSES,
  consentInputSchema,
  createFarmerSchema,
  familyNameSchema,
  farmerFilterSchema,
  formatFarmerNumber,
  givenNameSchema,
  nameMatchKey,
  nationalIdSchema,
  patchFarmerSchema,
  sexSchema,
  yearOfBirthSchema,
  type ConsentInput,
  type CreateFarmer,
  type FarmerFilter,
  type PatchFarmer,
  type RegistrationSource,
  type Sex,
  type VerificationStatus,
} from './farmer';
export {
  ESCALATION_DAYS,
  REJECTION_REASONS,
  VERIFICATION_DECISIONS,
  VERIFICATION_LIMITS,
  VERIFICATION_MESSAGES,
  VERIFICATION_STATES,
  VERIFICATION_TRANSITIONS,
  canTransition,
  daysWaiting,
  emptyBodySchema,
  isEscalated,
  mergeFarmerSchema,
  noteSchema,
  queueFilterSchema,
  rejectFarmerSchema,
  type MergeFarmer,
  type QueueFilter,
  type RejectFarmer,
  type RejectionReason,
  type VerificationDecision,
  type VerificationState,
} from './verification';
export {
  ACCURACY_FLAGS,
  ACCURACY_THRESHOLDS_M,
  FARM_LIMITS,
  FARM_MESSAGES,
  MIN_BOUNDARY_VERTICES,
  SEASON_NAMES,
  SEASON_PATTERN,
  addBoundarySchema,
  createFarmSchema,
  declareCropsSchema,
  geoJsonPolygonSchema,
  geojsonFilterSchema,
  gradeAccuracy,
  seasonSchema,
  type AccuracyFlag,
  type AddBoundary,
  type CreateFarm,
  type DeclareCrops,
  type GeoJsonPolygon,
  type GeojsonFilter,
} from './farm';
export {
  ATTACHMENT_CONTENT_TYPES,
  ATTACHMENT_FAILURE_CODES,
  ATTACHMENT_FAILURE_MESSAGES,
  ATTACHMENT_KINDS,
  ATTACHMENT_LIMITS,
  ATTACHMENT_STATUSES,
  ATTACHMENT_STATUS_MESSAGES,
  VISIT_ATTACHMENT_BUCKET,
  VISIT_LIMITS,
  VISIT_MESSAGES,
  VISIT_TOPICS,
  attachmentStoragePath,
  correctVisitSchema,
  declareAttachmentSchema,
  failAttachmentSchema,
  geoJsonPointSchema,
  recordVisitSchema,
  visitFilterSchema,
  type AttachmentFailureCode,
  type AttachmentKind,
  type AttachmentStatus,
  type CorrectVisit,
  type DeclareAttachment,
  type GeoJsonPoint,
  type RecordVisit,
  type VisitFilter,
  type VisitTopic,
} from './visit';
