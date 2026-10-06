import { z } from 'zod';

import { IDENTITY_MESSAGES, passwordSchema } from './identity';
import { locationCodeSchema } from './location';

/**
 * BUYER ACCOUNTS AND PROCUREMENT. Unit B13, criteria C-14B.1 to C-14B.22.
 *
 * Decided 2026-10-06 (docs/DECISIONS.md, "Buyers hold accounts"), superseding
 * the 2026-09-09 decision that buyers hold none. Every schema here runs on the
 * server before any query and on the client before any send, so a form and a
 * route cannot disagree about what is valid (CLAUDE.md, Validation).
 *
 * WHAT A BUYER NEVER SENDS. Nothing here accepts a verification status, an
 * organisation id, a farmer id, a price or a total from a buyer: standing is
 * an administrator's, the organisation is the session's, the seller is the
 * listing's, and the total is computed by the database. Every object is strict,
 * so an attempt to send one is a 400 naming the field (CONVENTIONS §8.1) --
 * mass assignment is refused by shape, not by a list of forbidden keys.
 */

// ---------------------------------------------------------------------------
// ENUMS -- each mirrors a Postgres enum in migration 20261006090000, or an
// earlier one for the listing pair.
// ---------------------------------------------------------------------------

export const LISTING_CATEGORIES = [
  'crop',
  'vegetable',
  'fruit',
  'livestock',
  'poultry',
  'dairy',
  'fish',
  'processed',
  'seeds_inputs',
  'other',
] as const;
export type ListingCategory = (typeof LISTING_CATEGORIES)[number];

export const LISTING_UNITS = [
  'kg',
  'bag_50kg',
  'bag_100kg',
  'sack',
  'crate',
  'bunch',
  'piece',
  'head',
  'litre',
  'tin',
] as const;
export type ListingUnit = (typeof LISTING_UNITS)[number];

export const LISTING_GRADES = ['a', 'b', 'c', 'ungraded'] as const;
export type ListingGrade = (typeof LISTING_GRADES)[number];

export const BUYER_ORGANIZATION_TYPES = [
  'trader',
  'aggregator',
  'processor',
  'wholesaler',
  'exporter',
  'food_company',
  'ngo',
  'institution',
  'government',
  'other',
] as const;
export type BuyerOrganizationType = (typeof BUYER_ORGANIZATION_TYPES)[number];

export const BUYER_VERIFICATION_STATUSES = [
  'pending',
  'under_review',
  'verified',
  'rejected',
  'suspended',
  'not_required',
] as const;
export type BuyerVerificationStatus = (typeof BUYER_VERIFICATION_STATUSES)[number];

/**
 * Individuals buy for themselves and need no review; a business is verified
 * by CORWADO before it may send requests (owner, 2026-10-06). An individual's
 * standing is `not_required`, never `verified`: nobody checked them, and the
 * record must not say somebody did.
 */
export const BUYER_ACCOUNT_TYPES = ['individual', 'business'] as const;
export type BuyerAccountType = (typeof BUYER_ACCOUNT_TYPES)[number];

/** The standing an account starts with. */
export const initialStanding = (type: BuyerAccountType): BuyerVerificationStatus =>
  type === 'individual' ? 'not_required' : 'pending';

/** A preference only. Payments are not in this phase. */
export const PAYMENT_PREFERENCES = [
  'cash_on_delivery',
  'bank_transfer',
  'mobile_money',
  'cheque',
  'other',
] as const;
export type PaymentPreference = (typeof PAYMENT_PREFERENCES)[number];

export const PURCHASE_REQUEST_STATUSES = [
  'draft',
  'submitted',
  'under_review',
  'accepted',
  'partially_fulfilled',
  'fulfilled',
  'cancelled',
  'rejected',
] as const;
export type PurchaseRequestStatus = (typeof PURCHASE_REQUEST_STATUSES)[number];

export const PURCHASE_ORDER_STATUSES = [
  'pending',
  'confirmed',
  'processing',
  'ready_for_delivery',
  'in_transit',
  'delivered',
  'completed',
  'cancelled',
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

/** Order states from which goods are moving: what the Deliveries screen lists. */
export const DELIVERY_STAGE_STATUSES: readonly PurchaseOrderStatus[] = [
  'ready_for_delivery',
  'in_transit',
  'delivered',
  'completed',
];

// ---------------------------------------------------------------------------
// STANDING -- what a buyer may do at each verification status (C-14B.3)
// ---------------------------------------------------------------------------

export interface BuyerCapabilities {
  /** Browse the buyer marketplace and read product details. */
  readonly browse: boolean;
  /** Create, submit and cancel purchase requests. */
  readonly request: boolean;
}

/**
 * THE ONE PLACE standing becomes permission. A new account can look but not
 * buy; a verified one can do both; a rejected or suspended one can read its
 * own history and profile and nothing else. Read by the routes, which enforce
 * it, and by the screens, which only explain it.
 */
export function buyerCapabilities(status: BuyerVerificationStatus): BuyerCapabilities {
  switch (status) {
    case 'verified':
    case 'not_required':
      return { browse: true, request: true };
    case 'pending':
    case 'under_review':
      return { browse: true, request: false };
    case 'rejected':
    case 'suspended':
      return { browse: false, request: false };
  }
}

/**
 * Which verification decisions an administrator may make from each status.
 * A buyer appears nowhere in this table: no route lets one move their own.
 */
export const BUYER_VERIFICATION_TRANSITIONS: Readonly<
  Record<BuyerVerificationStatus, readonly BuyerVerificationStatus[]>
> = {
  pending: ['under_review', 'verified', 'rejected'],
  under_review: ['verified', 'rejected'],
  verified: ['suspended'],
  rejected: ['under_review', 'not_required'],
  suspended: ['verified', 'rejected', 'not_required'],
  not_required: ['suspended', 'rejected'],
};

/** The standings each kind of account may ever hold. The database enforces the same. */
export const STANDINGS_FOR: Readonly<Record<BuyerAccountType, readonly BuyerVerificationStatus[]>> =
  {
    individual: ['not_required', 'rejected', 'suspended'],
    business: ['pending', 'under_review', 'verified', 'rejected', 'suspended'],
  };

/**
 * May an administrator move this account from one standing to another? Both
 * the transition table and the account's kind must allow it: an individual is
 * never put "under review" or "verified", and a business is never exempted.
 */
export const canMoveBuyer = (
  from: BuyerVerificationStatus,
  to: BuyerVerificationStatus,
  type: BuyerAccountType = 'business',
): boolean => BUYER_VERIFICATION_TRANSITIONS[from].includes(to) && STANDINGS_FOR[type].includes(to);

/** A buyer's own moves on their request. Everything else is a reviewer's. */
export const BUYER_REQUEST_ACTIONS = ['submit', 'cancel'] as const;
export type BuyerRequestAction = (typeof BUYER_REQUEST_ACTIONS)[number];

/** A reviewer's decisions on a submitted request, by current status. */
export const REQUEST_DECISION_TRANSITIONS: Readonly<
  Record<PurchaseRequestStatus, readonly PurchaseRequestStatus[]>
> = {
  draft: [],
  submitted: ['under_review', 'accepted', 'rejected'],
  under_review: ['accepted', 'rejected'],
  accepted: ['partially_fulfilled', 'fulfilled'],
  partially_fulfilled: ['fulfilled'],
  fulfilled: [],
  cancelled: [],
  rejected: [],
};

export const canDecideRequest = (from: PurchaseRequestStatus, to: PurchaseRequestStatus): boolean =>
  REQUEST_DECISION_TRANSITIONS[from].includes(to);

/** A buyer may cancel a request nobody has acted on yet. */
export const buyerMayCancelRequest = (status: PurchaseRequestStatus): boolean =>
  status === 'draft' || status === 'submitted';

/** Order progress, as staff record it. Forward only; cancellation before goods move. */
export const ORDER_TRANSITIONS: Readonly<
  Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]>
> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'ready_for_delivery', 'cancelled'],
  processing: ['ready_for_delivery', 'cancelled'],
  ready_for_delivery: ['in_transit', 'delivered'],
  in_transit: ['delivered'],
  delivered: ['completed'],
  completed: [],
  cancelled: [],
};

export const canMoveOrder = (from: PurchaseOrderStatus, to: PurchaseOrderStatus): boolean =>
  ORDER_TRANSITIONS[from].includes(to);

/** A buyer may cancel an order only while it is still pending. */
export const buyerMayCancelOrder = (status: PurchaseOrderStatus): boolean => status === 'pending';

// ---------------------------------------------------------------------------
// LIMITS AND MESSAGES -- every reason is pinned in CONVENTIONS §5.2.3
// ---------------------------------------------------------------------------

export const BUYER_LIMITS = {
  nameMax: 100,
  organizationNameMin: 2,
  organizationNameMax: 160,
  identifierMax: 64,
  cityMax: 120,
  addressMax: 300,
  websiteMax: 200,
  descriptionMax: 1000,
  productsMax: 20,
  productNameMax: 120,
  statesMax: 20,
  deliveryLocationsMax: 10,
  deliveryLocationMax: 200,
  notesMax: 1000,
  decisionNoteMax: 500,
  quantityMax: 100_000_000,
  priceMax: 100_000_000,
  searchMax: 100,
} as const;

export const BUYER_MESSAGES = {
  givenNameRequired: 'Enter your first name.',
  familyNameRequired: 'Enter your last name.',
  personNameTooLong: 'A name can be at most 100 characters.',
  buyerPhoneInvalid:
    'Enter a mobile number in international form, starting with + and the country code.',
  passwordsDiffer: 'The two passwords do not match.',
  organizationNameRequired: 'Enter the organisation name: 2 to 160 characters.',
  organizationTypeUnknown: 'Choose an organisation type from the list.',
  identifierTooLong: 'A registration or tax number can be at most 64 characters.',
  countryCodeInvalid: 'Give the country as a two-letter code, such as SS.',
  countyNeedsState: 'Choose a state before choosing a county.',
  cityTooLong: 'A city can be at most 120 characters.',
  addressTooLong: 'An address can be at most 300 characters.',
  websiteInvalid: 'Enter a website starting with http:// or https://, up to 200 characters.',
  organizationDescriptionTooLong: 'A description can be at most 1000 characters.',
  categoryUnknown: 'Choose a category from the list.',
  listExpected: 'Send this as a list.',
  productsTooMany: 'List at most 20 products.',
  productNameInvalid: 'A product name is 1 to 120 characters.',
  statesTooMany: 'Choose at most 20 production areas.',
  deliveryLocationsTooMany: 'List at most 10 delivery locations.',
  deliveryLocationInvalid: 'A delivery location is 2 to 200 characters.',
  monthInvalid: 'Choose purchasing months as numbers from 1 to 12.',
  paymentPreferenceUnknown: 'Choose a payment preference from the list.',
  quantityInvalid: 'Give the quantity as a number greater than zero.',
  quantityRangeInverted: 'The maximum quantity is less than the minimum.',
  unitUnknown: 'Choose a unit from the list.',
  requiredByInvalid: 'Give the date it is needed by as YYYY-MM-DD, today or later.',
  notesTooLong: 'Notes can be at most 1000 characters.',
  requestActionUnknown: 'Choose submit or cancel.',
  profileChangesNothing: 'Change at least one thing, or leave the profile as it is.',
  verificationStatusUnknown: 'Choose under_review, verified, rejected, suspended or not_required.',
  decisionNoteTooLong: 'A note can be at most 500 characters.',
  requestDecisionUnknown:
    'Choose under_review, accepted, rejected, partially_fulfilled or fulfilled.',
  orderStatusUnknown: 'Choose an order status from the list.',
  priceInvalid: 'Give the unit price in SSP as a number, zero or more.',
  identifierMalformed: 'The identifier is not in the expected form.',
  gradeUnknown: 'Choose a grade: a, b, c or ungraded.',
  searchTooLong: 'A search can be at most 100 characters.',
  filterNumberInvalid: 'Give the number as digits, zero or more.',
  filterDateInvalid: 'Give the date as YYYY-MM-DD.',
  priceRangeInverted: 'The highest price is less than the lowest.',
  supplierFilterUnknown: 'Choose verified to see only verified suppliers.',
  cancelReasonRequired: 'Say why the order is being cancelled, in up to 300 characters.',
  statusFilterUnknown: 'Choose a status from the list.',
  accountTypeUnknown: 'Choose individual or business.',
} as const;

// ---------------------------------------------------------------------------
// BUILDING BLOCKS
// ---------------------------------------------------------------------------

const uuidSchema = z
  .string({ error: () => BUYER_MESSAGES.identifierMalformed })
  .uuid(BUYER_MESSAGES.identifierMalformed);

const personName = (required: string) =>
  z
    .string({ error: () => required })
    .trim()
    .min(1, required)
    .max(BUYER_LIMITS.nameMax, BUYER_MESSAGES.personNameTooLong);

export const buyerEmailSchema = z
  .string({ error: () => IDENTITY_MESSAGES.emailInvalid })
  .trim()
  .toLowerCase()
  .email(IDENTITY_MESSAGES.emailInvalid)
  .max(254, IDENTITY_MESSAGES.emailInvalid);

/**
 * A buyer's mobile number, in E.164. A buyer may be an exporter abroad, so
 * this is not `phoneSchema`'s South Sudan rule; a South Sudan number written
 * locally (0912345678) is accepted and given its country code.
 */
export const buyerPhoneSchema = z
  .string({ error: () => BUYER_MESSAGES.buyerPhoneInvalid })
  .transform((raw) => raw.replace(/[\s-]/g, ''))
  .transform((compact) => (/^0\d{9}$/.test(compact) ? `+211${compact.slice(1)}` : compact))
  .refine((e164) => /^\+[1-9]\d{7,14}$/.test(e164), BUYER_MESSAGES.buyerPhoneInvalid);

const optionalText = (max: number, tooLong: string) =>
  z
    .string({ error: () => tooLong })
    .trim()
    .max(max, tooLong)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

const quantitySchema = z
  .number({ error: () => BUYER_MESSAGES.quantityInvalid })
  .positive(BUYER_MESSAGES.quantityInvalid)
  .max(BUYER_LIMITS.quantityMax, BUYER_MESSAGES.quantityInvalid);

const categorySchema = z.enum(LISTING_CATEGORIES, {
  error: () => BUYER_MESSAGES.categoryUnknown,
});
const unitSchema = z.enum(LISTING_UNITS, { error: () => BUYER_MESSAGES.unitUnknown });

/**
 * A real calendar date, YYYY-MM-DD, not before today (UTC).
 *
 * "Today" is read AT PARSE TIME, not when the schema is built. A schema built
 * once at module load would freeze the date for the life of a server process,
 * and a long-running instance would keep accepting yesterday as "today or
 * later" -- so the comparison happens inside the refinement, every time.
 */
const futureDateSchema = z
  .string({ error: () => BUYER_MESSAGES.requiredByInvalid })
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, BUYER_MESSAGES.requiredByInvalid)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, BUYER_MESSAGES.requiredByInvalid)
  .refine(
    (value) => value >= new Date().toISOString().slice(0, 10),
    BUYER_MESSAGES.requiredByInvalid,
  );

const deliveryLocationSchema = z
  .string({ error: () => BUYER_MESSAGES.deliveryLocationInvalid })
  .trim()
  .min(2, BUYER_MESSAGES.deliveryLocationInvalid)
  .max(BUYER_LIMITS.deliveryLocationMax, BUYER_MESSAGES.deliveryLocationInvalid);

const productNameSchema = z
  .string({ error: () => BUYER_MESSAGES.productNameInvalid })
  .trim()
  .min(1, BUYER_MESSAGES.productNameInvalid)
  .max(BUYER_LIMITS.productNameMax, BUYER_MESSAGES.productNameInvalid);

const uniqueList = <T extends z.ZodTypeAny>(item: T, max: number, tooMany: string) =>
  z
    .array(item, { error: () => BUYER_MESSAGES.listExpected })
    .max(max, tooMany)
    .transform((list) => [...new Set(list as unknown[])] as z.infer<T>[]);

// ---------------------------------------------------------------------------
// THE ORGANISATION AND PROCUREMENT FIELDS -- shared by registration and profile
// ---------------------------------------------------------------------------

const organizationFields = {
  organization_name: z
    .string({ error: () => BUYER_MESSAGES.organizationNameRequired })
    .trim()
    .min(BUYER_LIMITS.organizationNameMin, BUYER_MESSAGES.organizationNameRequired)
    .max(BUYER_LIMITS.organizationNameMax, BUYER_MESSAGES.organizationNameRequired),
  organization_type: z.enum(BUYER_ORGANIZATION_TYPES, {
    error: () => BUYER_MESSAGES.organizationTypeUnknown,
  }),
  registration_number: optionalText(BUYER_LIMITS.identifierMax, BUYER_MESSAGES.identifierTooLong),
  tax_id: optionalText(BUYER_LIMITS.identifierMax, BUYER_MESSAGES.identifierTooLong),
  country_code: z
    .string({ error: () => BUYER_MESSAGES.countryCodeInvalid })
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, BUYER_MESSAGES.countryCodeInvalid),
  state_id: locationCodeSchema.nullable().optional(),
  county_id: locationCodeSchema.nullable().optional(),
  city: optionalText(BUYER_LIMITS.cityMax, BUYER_MESSAGES.cityTooLong),
  address: optionalText(BUYER_LIMITS.addressMax, BUYER_MESSAGES.addressTooLong),
  website: z
    .string({ error: () => BUYER_MESSAGES.websiteInvalid })
    .trim()
    .max(BUYER_LIMITS.websiteMax, BUYER_MESSAGES.websiteInvalid)
    .refine((v) => v === '' || /^https?:\/\/\S+$/.test(v), BUYER_MESSAGES.websiteInvalid)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  description: optionalText(
    BUYER_LIMITS.descriptionMax,
    BUYER_MESSAGES.organizationDescriptionTooLong,
  ),
};

const procurementFields = {
  interested_categories: uniqueList(
    categorySchema,
    LISTING_CATEGORIES.length,
    BUYER_MESSAGES.categoryUnknown,
  ),
  interested_products: uniqueList(
    productNameSchema,
    BUYER_LIMITS.productsMax,
    BUYER_MESSAGES.productsTooMany,
  ),
  preferred_state_ids: uniqueList(
    locationCodeSchema,
    BUYER_LIMITS.statesMax,
    BUYER_MESSAGES.statesTooMany,
  ),
  min_quantity: quantitySchema.nullable().optional(),
  max_quantity: quantitySchema.nullable().optional(),
  preferred_unit: unitSchema.nullable().optional(),
  delivery_locations: uniqueList(
    deliveryLocationSchema,
    BUYER_LIMITS.deliveryLocationsMax,
    BUYER_MESSAGES.deliveryLocationsTooMany,
  ),
  purchasing_months: uniqueList(
    z
      .number({ error: () => BUYER_MESSAGES.monthInvalid })
      .int(BUYER_MESSAGES.monthInvalid)
      .min(1, BUYER_MESSAGES.monthInvalid)
      .max(12, BUYER_MESSAGES.monthInvalid),
    12,
    BUYER_MESSAGES.monthInvalid,
  ),
  payment_preferences: uniqueList(
    z.enum(PAYMENT_PREFERENCES, { error: () => BUYER_MESSAGES.paymentPreferenceUnknown }),
    PAYMENT_PREFERENCES.length,
    BUYER_MESSAGES.paymentPreferenceUnknown,
  ),
};

/** The cross-field rules the database also enforces, reported as field errors. */
function checkCrossFields(
  value: {
    state_id?: string | null;
    county_id?: string | null;
    min_quantity?: number | null;
    max_quantity?: number | null;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.county_id && !value.state_id) {
    ctx.addIssue({ code: 'custom', path: ['county_id'], message: BUYER_MESSAGES.countyNeedsState });
  }
  if (
    value.min_quantity != null &&
    value.max_quantity != null &&
    value.max_quantity < value.min_quantity
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['max_quantity'],
      message: BUYER_MESSAGES.quantityRangeInverted,
    });
  }
}

// ---------------------------------------------------------------------------
// REGISTRATION -- POST /api/buyer/register (C-14B.1, C-14B.2)
// ---------------------------------------------------------------------------

/**
 * An individual gives no organisation name or type: the account is named
 * after them and typed `other` by the route. A business must give both.
 */
export const buyerRegistrationSchema = z
  .strictObject({
    account_type: z
      .enum(BUYER_ACCOUNT_TYPES, { error: () => BUYER_MESSAGES.accountTypeUnknown })
      .default('business'),
    given_name: personName(BUYER_MESSAGES.givenNameRequired),
    family_name: personName(BUYER_MESSAGES.familyNameRequired),
    email: buyerEmailSchema,
    phone: buyerPhoneSchema,
    password: passwordSchema,
    confirm_password: z.string({ error: () => BUYER_MESSAGES.passwordsDiffer }),
    ...organizationFields,
    organization_name: organizationFields.organization_name.optional(),
    organization_type: organizationFields.organization_type.optional(),
    interested_categories: procurementFields.interested_categories.default([]),
    interested_products: procurementFields.interested_products.default([]),
    preferred_state_ids: procurementFields.preferred_state_ids.default([]),
    min_quantity: procurementFields.min_quantity,
    max_quantity: procurementFields.max_quantity,
    preferred_unit: procurementFields.preferred_unit,
    delivery_locations: procurementFields.delivery_locations.default([]),
    purchasing_months: procurementFields.purchasing_months.default([]),
    payment_preferences: procurementFields.payment_preferences.default([]),
  })
  .superRefine((value, ctx) => {
    if (value.password !== value.confirm_password) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirm_password'],
        message: BUYER_MESSAGES.passwordsDiffer,
      });
    }
    if (value.account_type === 'business') {
      if (!value.organization_name) {
        ctx.addIssue({
          code: 'custom',
          path: ['organization_name'],
          message: BUYER_MESSAGES.organizationNameRequired,
        });
      }
      if (!value.organization_type) {
        ctx.addIssue({
          code: 'custom',
          path: ['organization_type'],
          message: BUYER_MESSAGES.organizationTypeUnknown,
        });
      }
    }
    checkCrossFields(value, ctx);
  });
export type BuyerRegistration = z.infer<typeof buyerRegistrationSchema>;

// ---------------------------------------------------------------------------
// PROFILE -- PATCH /api/buyer/profile (C-14B.14)
// ---------------------------------------------------------------------------

/**
 * Every field optional, at least one present. No email or password here: the
 * address and the credential are the authentication service's, and changing
 * them is a sign-in concern, not a profile edit.
 */
export const buyerProfilePatchSchema = z
  .strictObject({
    given_name: personName(BUYER_MESSAGES.givenNameRequired).optional(),
    family_name: personName(BUYER_MESSAGES.familyNameRequired).optional(),
    phone: buyerPhoneSchema.optional(),
    organization_name: organizationFields.organization_name.optional(),
    organization_type: organizationFields.organization_type.optional(),
    registration_number: organizationFields.registration_number,
    tax_id: organizationFields.tax_id,
    country_code: organizationFields.country_code.optional(),
    state_id: organizationFields.state_id,
    county_id: organizationFields.county_id,
    city: organizationFields.city,
    address: organizationFields.address,
    website: organizationFields.website,
    description: organizationFields.description,
    interested_categories: procurementFields.interested_categories.optional(),
    interested_products: procurementFields.interested_products.optional(),
    preferred_state_ids: procurementFields.preferred_state_ids.optional(),
    min_quantity: procurementFields.min_quantity,
    max_quantity: procurementFields.max_quantity,
    preferred_unit: procurementFields.preferred_unit,
    delivery_locations: procurementFields.delivery_locations.optional(),
    purchasing_months: procurementFields.purchasing_months.optional(),
    payment_preferences: procurementFields.payment_preferences.optional(),
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: 'custom', path: [], message: BUYER_MESSAGES.profileChangesNothing });
    }
    checkCrossFields(value, ctx);
  });
export type BuyerProfilePatch = z.infer<typeof buyerProfilePatchSchema>;

/** The profile fields that live on the person; the rest are the organisation's. */
export const BUYER_PERSON_FIELDS = ['given_name', 'family_name', 'phone'] as const;

// ---------------------------------------------------------------------------
// MARKETPLACE -- GET /api/buyer/marketplace (C-14B.7, C-14B.9)
// ---------------------------------------------------------------------------

const decimalQuery = z
  .string({ error: () => BUYER_MESSAGES.filterNumberInvalid })
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, BUYER_MESSAGES.filterNumberInvalid)
  .transform(Number);

const dateQuery = z
  .string({ error: () => BUYER_MESSAGES.filterDateInvalid })
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, BUYER_MESSAGES.filterDateInvalid)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, BUYER_MESSAGES.filterDateInvalid);

/**
 * Every filter optional, every one validated before any query. Strings, because
 * they arrive as a query string. A filter the route does not offer is refused,
 * not ignored, so a screen cannot believe it filtered when it did not.
 */
export const marketplaceFilterSchema = z
  .strictObject({
    q: z
      .string({ error: () => BUYER_MESSAGES.searchTooLong })
      .trim()
      .max(BUYER_LIMITS.searchMax, BUYER_MESSAGES.searchTooLong)
      .optional(),
    category: categorySchema.optional(),
    state_id: locationCodeSchema.optional(),
    county_id: locationCodeSchema.optional(),
    min_quantity: decimalQuery.optional(),
    available_by: dateQuery.optional(),
    grade: z.enum(LISTING_GRADES, { error: () => BUYER_MESSAGES.gradeUnknown }).optional(),
    min_price: decimalQuery.optional(),
    max_price: decimalQuery.optional(),
    supplier: z
      .enum(['verified'], { error: () => BUYER_MESSAGES.supplierFilterUnknown })
      .optional(),
    limit: z.string().optional(),
    cursor: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.min_price !== undefined &&
      value.max_price !== undefined &&
      value.max_price < value.min_price
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['max_price'],
        message: BUYER_MESSAGES.priceRangeInverted,
      });
    }
  });
export type MarketplaceFilter = z.infer<typeof marketplaceFilterSchema>;

/** Paging only, for the buyer's own lists. */
export const buyerListFilterSchema = z.strictObject({
  status: z.string().trim().max(32).optional(),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});

// ---------------------------------------------------------------------------
// PURCHASE REQUESTS (C-14B.11)
// ---------------------------------------------------------------------------

/**
 * A new request. `submit: true` sends it for review at once; otherwise it is
 * saved as a draft. When `listing_id` is given, the route takes the category
 * and product from the listing and ignores nothing silently: the two sent here
 * must still be valid, and the listing's own are what is stored.
 */
export const purchaseRequestInputSchema = z.strictObject({
  listing_id: uuidSchema.optional(),
  category: categorySchema,
  product_name: productNameSchema,
  quantity: quantitySchema,
  unit: unitSchema,
  delivery_location: deliveryLocationSchema,
  required_by: futureDateSchema.nullable().optional(),
  notes: optionalText(BUYER_LIMITS.notesMax, BUYER_MESSAGES.notesTooLong),
  submit: z.boolean({ error: () => BUYER_MESSAGES.requestActionUnknown }).optional(),
});
export type PurchaseRequestInput = z.infer<typeof purchaseRequestInputSchema>;

/**
 * A buyer's change to their own request: edit a draft's fields, or take one of
 * the two actions. A request past draft is not editable; the route says so.
 */
export const purchaseRequestPatchSchema = z
  .strictObject({
    action: z
      .enum(BUYER_REQUEST_ACTIONS, { error: () => BUYER_MESSAGES.requestActionUnknown })
      .optional(),
    product_name: productNameSchema.optional(),
    quantity: quantitySchema.optional(),
    unit: unitSchema.optional(),
    delivery_location: deliveryLocationSchema.optional(),
    required_by: futureDateSchema.nullable().optional(),
    notes: optionalText(BUYER_LIMITS.notesMax, BUYER_MESSAGES.notesTooLong),
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({ code: 'custom', path: [], message: BUYER_MESSAGES.profileChangesNothing });
    }
  });
export type PurchaseRequestPatch = z.infer<typeof purchaseRequestPatchSchema>;

/** An order cancellation by its buyer, while still pending. */
export const buyerCancelOrderSchema = z.strictObject({
  reason: z
    .string({ error: () => BUYER_MESSAGES.cancelReasonRequired })
    .trim()
    .min(2, BUYER_MESSAGES.cancelReasonRequired)
    .max(300, BUYER_MESSAGES.cancelReasonRequired),
});

// ---------------------------------------------------------------------------
// ADMINISTRATOR DECISIONS (C-14B.3, C-14B.11, C-14B.12)
// ---------------------------------------------------------------------------

const decisionNote = optionalText(BUYER_LIMITS.decisionNoteMax, BUYER_MESSAGES.decisionNoteTooLong);

export const buyerVerificationDecisionSchema = z.strictObject({
  status: z.enum(['under_review', 'verified', 'rejected', 'suspended', 'not_required'], {
    error: () => BUYER_MESSAGES.verificationStatusUnknown,
  }),
  note: decisionNote,
});
export type BuyerVerificationDecision = z.infer<typeof buyerVerificationDecisionSchema>;

export const requestDecisionSchema = z.strictObject({
  status: z.enum(['under_review', 'accepted', 'rejected', 'partially_fulfilled', 'fulfilled'], {
    error: () => BUYER_MESSAGES.requestDecisionUnknown,
  }),
  note: decisionNote,
});
export type RequestDecision = z.infer<typeof requestDecisionSchema>;

/**
 * Staff arrange an order against a listing. The product, category, unit and
 * seller come from the listing on the server; the total from the database.
 */
export const createOrderSchema = z.strictObject({
  organization_id: uuidSchema,
  listing_id: uuidSchema,
  purchase_request_id: uuidSchema.optional(),
  quantity: quantitySchema,
  unit_price_ssp: z
    .number({ error: () => BUYER_MESSAGES.priceInvalid })
    .min(0, BUYER_MESSAGES.priceInvalid)
    .max(BUYER_LIMITS.priceMax, BUYER_MESSAGES.priceInvalid),
  delivery_location: deliveryLocationSchema,
  expected_delivery_date: futureDateSchema.nullable().optional(),
});
export type CreateOrder = z.infer<typeof createOrderSchema>;

export const orderStatusSchema = z.strictObject({
  status: z.enum(PURCHASE_ORDER_STATUSES, { error: () => BUYER_MESSAGES.orderStatusUnknown }),
  note: decisionNote,
});
export type OrderStatusChange = z.infer<typeof orderStatusSchema>;
