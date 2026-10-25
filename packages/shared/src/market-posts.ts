import { z } from 'zod';

import { BUYER_MESSAGES, LISTING_CATEGORIES, LISTING_UNITS } from './buyer';
import { locationCodeSchema } from './location';
import { phoneSchema } from './phone';

/**
 * LISTINGS LANE (2026-10-19) -- THE MARKETPLACE LIFECYCLE, BUYING REQUESTS AND
 * SERVICE LISTINGS. CORWADO's specification of 16 October 2026, as the owner
 * decided it on 19 October 2026 (docs/DECISIONS.md, "Listings: no verification
 * gate, one lifecycle, buying requests and services").
 *
 * One lifecycle for everything a person posts on the market:
 *
 *   draft      private to its owner
 *   active     visible on the market
 *   paused     the owner hid it for now, and can resume it
 *   expired    its date has passed -- COMPUTED, never stored; the owner renews
 *              it by giving a new date
 *   withdrawn  the owner ended it (or staff took it down); final
 *   completed  fulfilled; final
 *
 * An edit is an event, not a status. Produce listings keep their historic
 * stored values: `listed` is active and the legacy `sold` reads as completed
 * (enum values are only ever added, never renamed). Buying requests and
 * service listings are new tables and store the canonical words.
 */

// ---------------------------------------------------------------------------
// MESSAGES -- each pinned in docs/api/CONVENTIONS.md §5.2.3
// ---------------------------------------------------------------------------

export const MARKET_POST_MESSAGES = {
  statusUnknown: 'Choose draft, active, paused, withdrawn or completed.',
  displayNameInvalid: 'A name for the market is 2 to 120 characters.',
  locationInvalid: 'Give a town, payam or village, 2 to 160 characters.',
  dateInvalid: 'Give the date as YYYY-MM-DD.',
  dateInPast: 'Give a date from today onwards.',
  untilBeforeFrom: 'The end date cannot be before the start date.',
  textTooLong: 'This answer is too long.',
  descriptionRequired: 'Describe the service in a sentence or two.',
  serviceTypeUnknown: 'Choose tractor hire, transport, processing, storage or other.',
  priceUnitUnknown: 'Choose what the price is for.',
  priceOrNegotiable: 'Give a price, or tick negotiable.',
  priceUnitRequired: 'Say what the price is for.',
  saleQuantityInvalid: 'Give the quantity sold as a number greater than zero.',
  saleAboveRemaining: 'This is more than the quantity left on the listing.',
  quantityBelowSold: 'The quantity cannot be less than what you have already sold.',
  choiceUnknown: 'Choose yes or no.',
  posterUnknown: 'Choose farmer or buyer.',
  titleInvalid: 'A title is 2 to 200 characters.',
  stateUnknown: 'Choose a location from the list.',
  stateFromFarmerRecord: 'Your location comes from your farmer record.',
} as const;

const M = MARKET_POST_MESSAGES;

// ---------------------------------------------------------------------------
// THE LIFECYCLE
// ---------------------------------------------------------------------------

/** What buying requests and service listings store. */
export const MARKET_POST_STATUSES = [
  'draft',
  'active',
  'paused',
  'withdrawn',
  'completed',
] as const;
export type MarketPostStatus = (typeof MARKET_POST_STATUSES)[number];

/** Every stage a person can see, `expired` included. */
export const LIFECYCLE_STAGES = [
  'draft',
  'active',
  'paused',
  'expired',
  'withdrawn',
  'completed',
] as const;
export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

/** How long something stays on the market when its owner gives no end date. */
export const DEFAULT_VALIDITY_DAYS = 30;

/**
 * A stored status, in either vocabulary, as the canonical one. Produce
 * listings store `listed` (active) and the legacy `sold` (completed).
 */
export function canonicalStatus(stored: string): MarketPostStatus {
  switch (stored) {
    case 'listed':
    case 'active':
      return 'active';
    case 'paused':
      return 'paused';
    case 'withdrawn':
      return 'withdrawn';
    case 'sold':
    case 'completed':
      return 'completed';
    default:
      return 'draft';
  }
}

/** The canonical status as a produce listing stores it. */
export function listingStoredStatus(status: MarketPostStatus): string {
  return status === 'active' ? 'listed' : status;
}

/**
 * The stage a person sees. Only something active can be expired: a paused
 * post is still paused, and resuming it asks for a new date if it needs one.
 */
export function lifecycleStage(
  stored: string,
  endDate: string | null | undefined,
  today: string,
): LifecycleStage {
  const status = canonicalStatus(stored);
  if (status === 'active' && endDate && endDate < today) return 'expired';
  return status;
}

/**
 * The moves an owner may make. Withdrawn and completed are final: a listing
 * staff took off the market comes back only as a new listing, never by its
 * owner switching it on again.
 */
const MOVES: Record<MarketPostStatus, readonly MarketPostStatus[]> = {
  draft: ['active', 'withdrawn'],
  active: ['paused', 'withdrawn', 'completed'],
  paused: ['active', 'withdrawn', 'completed'],
  withdrawn: [],
  completed: [],
};

export function canMove(from: string, to: string): boolean {
  const a = canonicalStatus(from);
  const b = canonicalStatus(to);
  return a === b || MOVES[a].includes(b);
}

/** The owner's actions, as buttons. `renew` sets a new end date; `record_sale` is produce only. */
export const LIFECYCLE_ACTIONS = [
  'publish',
  'pause',
  'resume',
  'renew',
  'withdraw',
  'complete',
  'record_sale',
] as const;
export type LifecycleAction = (typeof LIFECYCLE_ACTIONS)[number];

/** Which actions an owner sees for something at this stage. */
export function lifecycleActions(
  stage: LifecycleStage,
  options: { sales?: boolean } = {},
): LifecycleAction[] {
  const sale: LifecycleAction[] = options.sales ? ['record_sale'] : [];
  switch (stage) {
    case 'draft':
      return ['publish', 'withdraw'];
    case 'active':
      return [...sale, 'pause', 'renew', 'complete', 'withdraw'];
    case 'expired':
      return ['renew', ...sale, 'complete', 'withdraw'];
    case 'paused':
      return ['resume', 'renew', ...sale, 'complete', 'withdraw'];
    default:
      return [];
  }
}

/** YYYY-MM-DD plus a number of days, in UTC. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The end date given, or `days` (thirty unless Settings say otherwise,
 * 2026-10-27) from the later of the start and today.
 */
export function defaultEndDate(
  given: string | null | undefined,
  from: string,
  today: string,
  days: number = DEFAULT_VALIDITY_DAYS,
): string {
  if (given) return given;
  return addDays(from > today ? from : today, days);
}

// ---------------------------------------------------------------------------
// BUILDING BLOCKS
// ---------------------------------------------------------------------------

const isoDate = z
  .string({ error: () => M.dateInvalid })
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, M.dateInvalid)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, M.dateInvalid);

const text = (min: number, max: number, message: string) =>
  z
    .string({ error: () => message })
    .trim()
    .min(min, message)
    .max(max, message);

const optionalText = (max: number) =>
  z
    .string({ error: () => M.textTooLong })
    .trim()
    .max(max, M.textTooLong)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const flag = z.boolean({ error: () => M.choiceUnknown });

const quantity = z
  .number({ error: () => BUYER_MESSAGES.quantityInvalid })
  .positive(BUYER_MESSAGES.quantityInvalid)
  .max(100_000_000, BUYER_MESSAGES.quantityInvalid);

const price = z
  .number({ error: () => BUYER_MESSAGES.priceInvalid })
  .min(0, BUYER_MESSAGES.priceInvalid)
  .max(100_000_000, BUYER_MESSAGES.priceInvalid);

const statusSchema = z.enum(MARKET_POST_STATUSES, { error: () => M.statusUnknown });

/** A new post is saved as a draft or published; the later moves are changes. */
const createStatusSchema = z.enum(['draft', 'active'], { error: () => M.statusUnknown });

/**
 * A change names only what changes: a create-time default must not apply, or
 * a one-field edit would reset the rest (the 2026-10-07 listing fault).
 */
function patchOf<T extends z.ZodRawShape>(shape: T) {
  return Object.fromEntries(
    Object.entries(shape).map(([k, v]) => {
      const schema = v as unknown as z.ZodTypeAny;
      const bare = schema instanceof z.ZodDefault ? (schema.unwrap() as z.ZodTypeAny) : schema;
      return [k, bare.optional()];
    }),
  ) as unknown as { [K in keyof T]: z.ZodOptional<T[K]> };
}

const atLeastOne = (value: Record<string, unknown>, ctx: z.RefinementCtx) => {
  if (Object.values(value).every((v) => v === undefined)) {
    ctx.addIssue({ code: 'custom', path: [], message: BUYER_MESSAGES.profileChangesNothing });
  }
};

// ---------------------------------------------------------------------------
// PRODUCE LISTINGS -- a sale recorded against the quantity
// ---------------------------------------------------------------------------

/**
 * POST /api/farmer/listings/:id/sales. The quantity sold comes off what is
 * left; when nothing is left the listing is completed. `close` completes it
 * now whatever is left (the owner says it is fulfilled).
 */
export const listingSaleSchema = z.strictObject({
  quantity: z
    .number({ error: () => M.saleQuantityInvalid })
    .positive(M.saleQuantityInvalid)
    .max(100_000_000, M.saleQuantityInvalid),
  close: flag.default(false),
});
export type ListingSale = z.infer<typeof listingSaleSchema>;

// ---------------------------------------------------------------------------
// BUYING REQUESTS -- "I need X of Y in Z by date"
// ---------------------------------------------------------------------------

/**
 * Anyone signed in -- a farmer or a buyer account -- may post one. Who posted
 * it is the session's account, never a field: the poster type and id are
 * resolved on the server. NOT a purchase_request, which a buyer sends to one
 * listing; the specification: "buying requests are not inquiries".
 */
const buyingRequestShape = {
  display_name: text(2, 120, M.displayNameInvalid),
  category: z.enum(LISTING_CATEGORIES, { error: () => BUYER_MESSAGES.categoryUnknown }),
  product_name: text(1, 120, BUYER_MESSAGES.productNameInvalid),
  quantity,
  unit: z.enum(LISTING_UNITS, { error: () => BUYER_MESSAGES.unitUnknown }),
  state_id: locationCodeSchema,
  location: text(2, 160, M.locationInvalid),
  needed_by: isoDate,
  price_ssp: price.nullable().optional(),
  price_per: z
    .enum(LISTING_UNITS, { error: () => BUYER_MESSAGES.unitUnknown })
    .nullable()
    .optional(),
  negotiable: flag.default(true),
  delivery_terms: optionalText(500),
  description: optionalText(1000),
  contact_phone: phoneSchema.optional(),
  // 2026-10-20: the phone is shown only if the poster chooses; off unless ticked.
  show_phone: flag.default(false),
};

const priceNeedsUnit = (
  value: { price_ssp?: unknown; price_per?: unknown },
  ctx: z.RefinementCtx,
  unitKey: string,
) => {
  if (value.price_ssp != null && value.price_per === null) {
    ctx.addIssue({ code: 'custom', path: [unitKey], message: M.priceUnitRequired });
  }
};

export const buyingRequestSchema = z
  .strictObject({
    id: z.string().uuid(BUYER_MESSAGES.identifierMalformed).optional(),
    ...buyingRequestShape,
    status: createStatusSchema.default('active'),
  })
  .superRefine((value, ctx) => {
    if (value.price_ssp != null && value.price_per == null) {
      ctx.addIssue({ code: 'custom', path: ['price_per'], message: M.priceUnitRequired });
    }
  });
export type BuyingRequestInput = z.infer<typeof buyingRequestSchema>;

/** A change: any field, at least one; `status` moves it through the lifecycle. */
export const buyingRequestPatchSchema = z
  .strictObject({ ...patchOf(buyingRequestShape), status: statusSchema.optional() })
  .superRefine((value, ctx) => {
    atLeastOne(value, ctx);
    priceNeedsUnit(value, ctx, 'price_per');
  });
export type BuyingRequestPatch = z.infer<typeof buyingRequestPatchSchema>;

/** GET /api/buying-requests: search and filter. Every one optional. */
export const buyingRequestFilterSchema = z.strictObject({
  q: z.string().trim().max(100).optional(),
  category: z.enum(LISTING_CATEGORIES, { error: () => BUYER_MESSAGES.categoryUnknown }).optional(),
  state_id: locationCodeSchema.optional(),
  poster: z.enum(['farmer', 'buyer'], { error: () => M.posterUnknown }).optional(),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});

// ---------------------------------------------------------------------------
// SERVICE LISTINGS -- tractor hire, transport, processing, storage, other
// ---------------------------------------------------------------------------

export const SERVICE_TYPES = [
  'tractor_hire',
  'transport',
  'processing',
  'storage',
  'other',
] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

export const SERVICE_PRICE_UNITS = [
  'per_hour',
  'per_day',
  'per_acre',
  'per_feddan',
  'per_trip',
  'per_bag',
  'per_kg',
  'per_job',
] as const;
export type ServicePriceUnit = (typeof SERVICE_PRICE_UNITS)[number];

/**
 * Offered by any account, farmer or buyer (2026-10-26, replacing "owned by a
 * farmer account for now"; docs/DECISIONS.md, "Services: any account may offer
 * one"). Who offers it is the session's account, never a field. No stock, so
 * no sales.
 *
 * WHERE IT IS. A farmer's service takes the payam and state of the farmer's
 * record, so a farmer never sends `state_id` (refused: stateFromFarmerRecord).
 * A buyer account has no payam: it MUST send `state_id`, from the state list
 * (servicePosterIssue; buyerServiceListingSchema on the buyer's form).
 */
const serviceShape = {
  trading_name: text(2, 120, M.displayNameInvalid),
  service_type: z.enum(SERVICE_TYPES, { error: () => M.serviceTypeUnknown }),
  title: text(2, 200, M.titleInvalid),
  description: text(1, 1000, M.descriptionRequired),
  location: text(2, 160, M.locationInvalid),
  available_from: isoDate,
  available_until: isoDate.nullable().optional(),
  availability_note: optionalText(300),
  price_ssp: price.nullable().optional(),
  price_unit: z
    .enum(SERVICE_PRICE_UNITS, { error: () => M.priceUnitUnknown })
    .nullable()
    .optional(),
  negotiable: flag.default(false),
  contact_phone: phoneSchema.optional(),
  // 2026-10-20: the phone is shown only if the poster chooses; off unless ticked.
  show_phone: flag.default(false),
  // 2026-10-26: a buyer account's service only (see above).
  state_id: locationCodeSchema.optional(),
};

/** Who is offering a service, as the server resolves it from the session. */
export type ServicePosterType = 'farmer' | 'buyer';

/**
 * The location rule that depends on who is posting, which a body cannot say:
 * a buyer must name a state, a farmer must not (theirs is the record's). The
 * route applies it on create (`creating`) and on every change; the forms use
 * it through the schemas below. Returns the field and its reason, or null.
 */
export function servicePosterIssue(
  poster: ServicePosterType,
  value: { state_id?: string | undefined },
  creating: boolean,
): { field: 'state_id'; message: string } | null {
  if (poster === 'farmer' && value.state_id !== undefined) {
    return { field: 'state_id', message: M.stateFromFarmerRecord };
  }
  if (poster === 'buyer' && creating && !value.state_id) {
    return { field: 'state_id', message: M.stateUnknown };
  }
  return null;
}

const serviceObject = z.strictObject({
  id: z.string().uuid(BUYER_MESSAGES.identifierMalformed).optional(),
  ...serviceShape,
  status: createStatusSchema.default('draft'),
});

const serviceRules = (value: z.infer<typeof serviceObject>, ctx: z.RefinementCtx) => {
  if (value.price_ssp == null && !value.negotiable) {
    ctx.addIssue({ code: 'custom', path: ['price_ssp'], message: M.priceOrNegotiable });
  }
  if (value.price_ssp != null && value.price_unit == null) {
    ctx.addIssue({ code: 'custom', path: ['price_unit'], message: M.priceUnitRequired });
  }
  if (value.available_until && value.available_until < value.available_from) {
    ctx.addIssue({ code: 'custom', path: ['available_until'], message: M.untilBeforeFrom });
  }
};

const posterRule =
  (poster: ServicePosterType) =>
  (value: { state_id?: string | undefined }, ctx: z.RefinementCtx, creating: boolean) => {
    const issue = servicePosterIssue(poster, value, creating);
    if (issue) ctx.addIssue({ code: 'custom', path: [issue.field], message: issue.message });
  };

/**
 * POST /api/services, for either kind of account: the route then applies
 * servicePosterIssue for the session's poster. The forms use the two below.
 */
export const serviceListingSchema = serviceObject.superRefine(serviceRules);
export type ServiceListingInput = z.infer<typeof serviceListingSchema>;

/** A farmer's new service: no state (the record's). */
export const farmerServiceListingSchema = serviceObject.superRefine((value, ctx) => {
  serviceRules(value, ctx);
  posterRule('farmer')(value, ctx, true);
});

/** A buyer account's new service: a state from the list is required. */
export const buyerServiceListingSchema = serviceObject.superRefine((value, ctx) => {
  serviceRules(value, ctx);
  posterRule('buyer')(value, ctx, true);
});

export const serviceListingPatchSchema = z
  .strictObject({ ...patchOf(serviceShape), status: statusSchema.optional() })
  .superRefine((value, ctx) => {
    atLeastOne(value, ctx);
    priceNeedsUnit({ price_ssp: value.price_ssp, price_per: value.price_unit }, ctx, 'price_unit');
  });
export type ServiceListingPatch = z.infer<typeof serviceListingPatchSchema>;

export const serviceFilterSchema = z.strictObject({
  q: z.string().trim().max(100).optional(),
  service_type: z.enum(SERVICE_TYPES, { error: () => M.serviceTypeUnknown }).optional(),
  state_id: locationCodeSchema.optional(),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});

// ---------------------------------------------------------------------------
// REPORTS -- the product-report mechanism, for the two new kinds of post
// ---------------------------------------------------------------------------

/** What a market report is about. Produce listings keep their own table. */
/** 2026-10-23: and a published public profile (public profiles v2). */
export const MARKET_REPORT_TARGETS = ['buying_request', 'service_listing', 'profile'] as const;
export type MarketReportTarget = (typeof MARKET_REPORT_TARGETS)[number];
