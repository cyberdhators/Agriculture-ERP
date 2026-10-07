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
  BUYER_ROLE,
  FARMER_ROLE,
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
export { z } from 'zod';
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
  reassignFarmerSchema,
  sexSchema,
  yearOfBirthSchema,
  type ConsentInput,
  type CreateFarmer,
  type FarmerFilter,
  type PatchFarmer,
  type ReassignFarmer,
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
  farmFilterSchema,
  geoJsonPolygonSchema,
  geojsonFilterSchema,
  gradeAccuracy,
  seasonSchema,
  type AccuracyFlag,
  type AddBoundary,
  type CreateFarm,
  type DeclareCrops,
  type FarmFilter,
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
export {
  DEVICE_ID_HEADER,
  DEVICE_ID_PATTERN,
  SYNC_ENTITIES,
  SYNC_MESSAGES,
  SYNC_OUTCOMES,
  SYNC_OUTCOME_SPECS,
  deviceIdSchema,
  syncOutcomeFor,
  type SyncAction,
  type SyncEntity,
  type SyncOutcome,
  type SyncOutcomeSpec,
} from './sync';
export {
  AGE_BANDS,
  AGE_BAND_NOTE,
  CROP_NOTE,
  REPORT_MESSAGES,
  REPORT_TYPES,
  VERIFIED_ONLY_NOTE,
  ageBandAt,
  exportListFilterSchema,
  exportRequestSchema,
  reportFilterSchema,
  type AgeBandKey,
  type ExportRequest,
  type ReportFilter,
  type ReportType,
} from './report';
export * from './weather';

// Administrator communications and marketplace product reports. Both are
// contracts proposed on 2026-09-17 and approved as scope additions; neither has
// a route behind it yet. Appended, never reordered (HANDOFF's shared-objects
// rule).
export {
  CHANNEL_RECIPIENTS,
  COMMUNICATION_CHANNELS,
  COMMUNICATION_LIMITS,
  COMMUNICATION_MESSAGES,
  RECIPIENT_TYPES,
  sendCommunicationSchema,
  type CommunicationChannel,
  type CommunicationResult,
  type RecipientType,
  type SendCommunication,
} from './communications';

export {
  MODERATION_ACTIONS,
  PRODUCT_REPORT_LIMITS,
  PRODUCT_REPORT_MESSAGES,
  REPORT_REASONS,
  REPORT_STATUSES,
  moderateReportSchema,
  productReportFilterSchema,
  submitProductReportSchema,
  type ModerateReport,
  type ModerationAction,
  type ProductReport,
  type ProductReportFilter,
  type ReportReason,
  type ReportStatus,
  type SubmitProductReport,
  type UnreadReportCount,
} from './product-reports';

// B13 (2026-10-06): buyer accounts and procurement. Appended, never reordered.
export {
  BUYER_ACCOUNT_TYPES,
  BUYER_LIMITS,
  BUYER_MESSAGES,
  STANDINGS_FOR,
  initialStanding,
  type BuyerAccountType,
  BUYER_ORGANIZATION_TYPES,
  BUYER_PERSON_FIELDS,
  BUYER_REQUEST_ACTIONS,
  BUYER_VERIFICATION_STATUSES,
  BUYER_VERIFICATION_TRANSITIONS,
  DELIVERY_STAGE_STATUSES,
  LISTING_CATEGORIES,
  LISTING_GRADES,
  LISTING_UNITS,
  ORDER_TRANSITIONS,
  PAYMENT_PREFERENCES,
  PURCHASE_ORDER_STATUSES,
  PURCHASE_REQUEST_STATUSES,
  REQUEST_DECISION_TRANSITIONS,
  CART_MAX_ITEMS,
  cartCheckoutSchema,
  cartItemSchema,
  type CartCheckout,
  buyerCancelOrderSchema,
  buyerCapabilities,
  buyerEmailSchema,
  buyerListFilterSchema,
  buyerMayCancelOrder,
  buyerMayCancelRequest,
  buyerPhoneSchema,
  buyerProfilePatchSchema,
  buyerRegistrationSchema,
  buyerVerificationDecisionSchema,
  canDecideRequest,
  canMoveBuyer,
  canMoveOrder,
  createOrderSchema,
  marketplaceFilterSchema,
  orderStatusSchema,
  purchaseRequestInputSchema,
  purchaseRequestPatchSchema,
  requestDecisionSchema,
  type BuyerCapabilities,
  type BuyerOrganizationType,
  type BuyerProfilePatch,
  type BuyerRegistration,
  type BuyerRequestAction,
  type BuyerVerificationDecision,
  type BuyerVerificationStatus,
  type CreateOrder,
  type ListingCategory,
  type ListingGrade,
  type ListingUnit,
  type MarketplaceFilter,
  type OrderStatusChange,
  type PaymentPreference,
  type PurchaseOrderStatus,
  type PurchaseRequestInput,
  type PurchaseRequestPatch,
  type PurchaseRequestStatus,
  type RequestDecision,
} from './buyer';

// B14 (2026-10-07): farmer accounts, the registration-form profile, farmer-owned
// listings and farmers' answers to buyers. Appended, never reordered.
export * from './farmer-account';
