import { z } from 'zod';

import { BUYER_MESSAGES, LISTING_CATEGORIES, LISTING_GRADES, LISTING_UNITS } from './buyer';
import {
  consentInputSchema,
  familyNameSchema,
  givenNameSchema,
  sexSchema,
  yearOfBirthSchema,
} from './farmer';
import { locationCodeSchema } from './location';
import { parseSouthSudanMobile, phoneSchema } from './phone';

/**
 * B14 -- FARMERS HOLD ACCOUNTS (2026-10-07).
 *
 * CORWADO has no staff to enrol farmers: farmers register themselves, list
 * their own produce, and deal with buyers directly; officers help the few who
 * cannot, case by case (docs/DECISIONS.md, "Farmers enrol themselves and deal
 * with buyers directly"). The registration asks what CORWADO's own paper form
 * asks, sections B to F and H ("Offline Version - Proposed Farmer Registration
 * Form"), with the form's required fields required here.
 */

// ---------------------------------------------------------------------------
// THE SIGN-IN IDENTIFIER
// ---------------------------------------------------------------------------

/** RFC 2606: undeliverable for ever, so no mail can reach a farmer's identifier. */
export const FARMER_AUTH_DOMAIN = 'farmers.invalid';

/**
 * A farmer signs in with a phone number and a password. The phone addresses
 * the authentication service through this one derivation, exactly as an
 * officer's does, so every written form of one number is one account, and
 * one phone number is one farmer account (the owner's choice, 2026-10-07).
 */
export function farmerAuthIdentifier(phone: string): string {
  const parsed = parseSouthSudanMobile(phone);
  if (!parsed.ok) {
    throw new Error('farmerAuthIdentifier requires a valid South Sudan mobile number');
  }
  return `farmer.${parsed.value.slice(1)}@${FARMER_AUTH_DOMAIN}`;
}

// ---------------------------------------------------------------------------
// THE FORM'S LISTS -- each mirrors a CHECK in migration 20261007090000
// ---------------------------------------------------------------------------

export const FARMER_ID_TYPES = ['national_id', 'passport', 'chief_letter', 'other'] as const;
export const EDUCATION_LEVELS = ['none', 'primary', 'secondary', 'tertiary'] as const;
export const PHONE_TYPES = ['smartphone', 'basic', 'none'] as const;
export const CONTACT_CHANNELS = ['sms', 'whatsapp', 'voice', 'app'] as const;
export const HEARD_VIA = ['cooperative', 'community_leader', 'ngo', 'walk_in', 'other'] as const;
export const LAND_UNITS = ['feddan', 'acre', 'hectare'] as const;
export const LAND_TENURES = ['owned', 'rented', 'communal', 'other'] as const;
export const SERVICES_WANTED = [
  'extension',
  'agronomy',
  'market_information',
  'transport',
  'buyers',
  'other',
] as const;

/**
 * The form's crop list, section E. A PROFILE answer -- what the farmer grows --
 * deliberately separate from the five-crop `crop` enum that farm crop
 * declarations use under the signed C-7.7, which this does not widen.
 */
export const PROFILE_CROPS = [
  'maize',
  'sorghum',
  'cassava',
  'groundnut',
  'sesame',
  'beans',
  'vegetables',
  'fruits',
  'rice',
  'millet',
  'cowpea',
  'other',
] as const;

export type FarmerIdType = (typeof FARMER_ID_TYPES)[number];
export type ProfileCrop = (typeof PROFILE_CROPS)[number];

// ---------------------------------------------------------------------------
// MESSAGES -- every reason is pinned in CONVENTIONS §5.2.3
// ---------------------------------------------------------------------------

export const FARMER_ACCOUNT_MESSAGES = {
  idTypeUnknown: 'Choose the kind of identity document.',
  idNumberInvalid: 'An identity number is 3 to 40 characters.',
  dateOfBirthInvalid: 'Give the date of birth as YYYY-MM-DD, or leave it out and give the year.',
  choiceUnknown: 'Choose an answer from the list.',
  nextOfKinRequired: 'Give the name of a next of kin or another person to contact.',
  relationshipRequired: 'Say how that person is related to you.',
  nextOfKinPhoneInvalid: 'Give the next of kin phone as a South Sudan mobile number.',
  villageRequired: 'Give your village or boma.',
  textTooLong: 'This answer is too long.',
  cropsRequired: 'Choose at least one crop you grow.',
  landSizeInvalid: 'Give the land under cultivation as a number greater than zero.',
  tenureRequired: 'Choose how you hold the land.',
  yearsInvalid: 'Give a number of years from 0 to 100.',
  groupAnswerRequired: 'Say whether you belong to a cooperative or group.',
  countInvalid: 'Give a whole number from 0 to 200.',
  servicesRequired: 'Choose at least one service you want.',
  tradingNameInvalid: 'A farm or stall name is 2 to 120 characters.',
  titleInvalid: 'A title is 2 to 200 characters.',
  descriptionTooLong: 'A description can be at most 1000 characters.',
  listingStatusUnknown: 'Choose draft, listed, withdrawn or sold.',
  dateInvalid: 'Give the date as YYYY-MM-DD.',
  minOrderTooLarge: 'The minimum order cannot be more than the quantity.',
  answerUnknown: 'Choose accept or decline.',
  phoneChangesNothing: 'That is already your phone number.',
  passwordTooShort: 'Choose 6 or more characters you will remember.',
} as const;

const M = FARMER_ACCOUNT_MESSAGES;

/**
 * A farmer's password: six or more characters and nothing else (B12 point 2),
 * the rule the registration screen has always shown. Staff passwords stay at
 * twelve; a farmer types this on a basic phone and must remember it.
 */
export const FARMER_PASSWORD_MIN = 6;
export const farmerPasswordSchema = z
  .string({ error: () => M.passwordTooShort })
  .min(FARMER_PASSWORD_MIN, M.passwordTooShort)
  .max(72, M.textTooLong);

// ---------------------------------------------------------------------------
// BUILDING BLOCKS
// ---------------------------------------------------------------------------

const choice = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values, { error: () => M.choiceUnknown });

const text = (max: number, required?: string) => {
  const base = z
    .string({ error: () => required ?? M.textTooLong })
    .trim()
    .max(max, M.textTooLong);
  return required ? base.min(1, required) : base;
};

const optionalText = (max: number) =>
  text(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const count = (max = 200, message: string = M.countInvalid) =>
  z
    .number({ error: () => message })
    .int(message)
    .min(0, message)
    .max(max, message);

const isoDate = (message: string) =>
  z
    .string({ error: () => message })
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, message)
    .refine((value) => {
      const parsed = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    }, message);

const uniqueList = <T extends z.ZodTypeAny>(item: T, max: number, message: string) =>
  z
    .array(item, { error: () => message })
    .max(max, message)
    .transform((list) => [...new Set(list as unknown[])] as z.infer<T>[]);

// ---------------------------------------------------------------------------
// THE PROFILE -- sections B to F and H of CORWADO's form
// ---------------------------------------------------------------------------

/**
 * The profile answers. Only the village is required (owner, 2026-10-07: "farmers
 * registration simple and not fully dependent on extension officer"); every
 * other answer from CORWADO's form is optional, so a farmer completes sign-up
 * alone and adds the rest when they can.
 */
export const farmerProfileFields = {
  // B. Personal
  date_of_birth: isoDate(M.dateOfBirthInvalid).nullable().optional(),
  age_estimated: z.boolean({ error: () => M.choiceUnknown }).default(false),
  id_type: choice(FARMER_ID_TYPES).nullable().optional(),
  id_number: text(40)
    .refine((v) => v === '' || v.length >= 3, M.idNumberInvalid)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  education_level: choice(EDUCATION_LEVELS).nullable().optional(),
  // C. Contact
  alt_phone: phoneSchema.nullable().optional(),
  phone_type: choice(PHONE_TYPES).nullable().optional(),
  has_whatsapp: z
    .boolean({ error: () => M.choiceUnknown })
    .nullable()
    .optional(),
  preferred_channel: choice(CONTACT_CHANNELS).nullable().optional(),
  next_of_kin_name: optionalText(120),
  next_of_kin_relationship: optionalText(60),
  next_of_kin_phone: z
    .string({ error: () => M.nextOfKinPhoneInvalid })
    .transform((v, ctx) => {
      if (v.trim() === '') return null;
      const parsed = parseSouthSudanMobile(v);
      if (!parsed.ok) {
        ctx.addIssue({ code: 'custom', message: M.nextOfKinPhoneInvalid });
        return z.NEVER;
      }
      return parsed.value;
    })
    .nullable()
    .optional(),
  next_of_kin_location: optionalText(160),
  // A. How the farmer heard of the platform
  heard_via: choice(HEARD_VIA).nullable().optional(),
  // D. Location (state, county and payam are the farmer record's)
  village: text(120, M.villageRequired),
  landmark: optionalText(160),
  // E. Farming profile
  primary_crops: uniqueList(choice(PROFILE_CROPS), PROFILE_CROPS.length, M.cropsRequired).default(
    [],
  ),
  other_crops: optionalText(300),
  land_size: z
    .number({ error: () => M.landSizeInvalid })
    .positive(M.landSizeInvalid)
    .max(100_000, M.landSizeInvalid)
    .nullable()
    .optional(),
  land_unit: choice(LAND_UNITS).nullable().optional(),
  land_measured: z
    .boolean({ error: () => M.choiceUnknown })
    .nullable()
    .optional(),
  land_tenure: z
    .enum(LAND_TENURES, { error: () => M.tenureRequired })
    .nullable()
    .optional(),
  years_farming: count(100, M.yearsInvalid).nullable().optional(),
  group_member: z
    .boolean({ error: () => M.groupAnswerRequired })
    .nullable()
    .optional(),
  group_name: optionalText(160),
  group_role: optionalText(60),
  group_years: count(100, M.yearsInvalid).nullable().optional(),
  // F. Household
  household_size: count().nullable().optional(),
  household_adults: count().nullable().optional(),
  household_children: count().nullable().optional(),
  farm_workers: count().nullable().optional(),
  // H. Services wanted
  services_wanted: uniqueList(
    choice(SERVICES_WANTED),
    SERVICES_WANTED.length,
    M.servicesRequired,
  ).default([]),
};

export const PROFILE_FIELD_NAMES = Object.keys(
  farmerProfileFields,
) as (keyof typeof farmerProfileFields)[];

// ---------------------------------------------------------------------------
// SELF-REGISTRATION -- POST /api/farmer/register
// ---------------------------------------------------------------------------

export const farmerSelfRegisterSchema = z
  .strictObject({
    given_name: givenNameSchema,
    family_name: familyNameSchema,
    sex: sexSchema,
    year_of_birth: yearOfBirthSchema,
    phone: phoneSchema,
    password: farmerPasswordSchema,
    confirm_password: z.string({ error: () => BUYER_MESSAGES.passwordsDiffer }),
    payam_id: locationCodeSchema,
    consent: consentInputSchema,
    ...farmerProfileFields,
  })
  .superRefine((value, ctx) => {
    if (value.password !== value.confirm_password) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirm_password'],
        message: BUYER_MESSAGES.passwordsDiffer,
      });
    }
  });
export type FarmerSelfRegister = z.infer<typeof farmerSelfRegisterSchema>;

/** A phone change on the farmer's own account. The password is checked by sign-in, client-side. */
export const farmerPhoneChangeSchema = z.strictObject({ phone: phoneSchema });

// ---------------------------------------------------------------------------
// THE FARMER'S OWN LISTINGS -- /api/farmer/listings
// ---------------------------------------------------------------------------

export const FARMER_LISTING_STATUSES = ['draft', 'listed', 'withdrawn', 'sold'] as const;

const listingFields = {
  trading_name: text(120, M.tradingNameInvalid).refine((v) => v.length >= 2, M.tradingNameInvalid),
  title: text(200, M.titleInvalid).refine((v) => v.length >= 2, M.titleInvalid),
  category: z.enum(LISTING_CATEGORIES, { error: () => BUYER_MESSAGES.categoryUnknown }),
  product_name: text(120, BUYER_MESSAGES.productNameInvalid),
  description: text(1000).default(''),
  quantity: z
    .number({ error: () => BUYER_MESSAGES.quantityInvalid })
    .positive(BUYER_MESSAGES.quantityInvalid)
    .max(100_000_000, BUYER_MESSAGES.quantityInvalid),
  unit: z.enum(LISTING_UNITS, { error: () => BUYER_MESSAGES.unitUnknown }),
  price_ssp: z
    .number({ error: () => BUYER_MESSAGES.priceInvalid })
    .min(0, BUYER_MESSAGES.priceInvalid)
    .max(100_000_000, BUYER_MESSAGES.priceInvalid),
  price_per: z.enum(LISTING_UNITS, { error: () => BUYER_MESSAGES.unitUnknown }),
  negotiable: z.boolean({ error: () => M.choiceUnknown }).default(false),
  delivery_available: z.boolean({ error: () => M.choiceUnknown }).default(false),
  available_from: isoDate(M.dateInvalid),
  available_until: isoDate(M.dateInvalid).nullable().optional(),
  harvest_season: optionalText(60),
  pickup_notes: optionalText(500),
  contact_phone: phoneSchema.optional(),
  quality_grade: z
    .enum(LISTING_GRADES, { error: () => BUYER_MESSAGES.gradeUnknown })
    .nullable()
    .optional(),
  min_order_quantity: z
    .number({ error: () => BUYER_MESSAGES.quantityInvalid })
    .positive(BUYER_MESSAGES.quantityInvalid)
    .nullable()
    .optional(),
  status: z.enum(FARMER_LISTING_STATUSES, { error: () => M.listingStatusUnknown }).default('draft'),
};

/** A new listing. The owner is the session's farmer, never a field. */
export const farmerListingSchema = z
  .strictObject({
    id: z.string().uuid(BUYER_MESSAGES.identifierMalformed).optional(),
    ...listingFields,
  })
  .superRefine((value, ctx) => {
    if (value.min_order_quantity != null && value.min_order_quantity > value.quantity) {
      ctx.addIssue({ code: 'custom', path: ['min_order_quantity'], message: M.minOrderTooLarge });
    }
  });
export type FarmerListingInput = z.infer<typeof farmerListingSchema>;

/** A change to one of the farmer's own listings: any field, at least one. */
/**
 * A change names only what changes. A field's create-time default must NOT
 * apply here: zod fills a default even inside .optional(), so a price-only
 * edit used to reset status to 'draft' (pulling the listing out of the
 * market), blank the description and clear negotiable/delivery. Found by the
 * live end-to-end check, 2026-10-07.
 */
const withoutDefault = (schema: z.ZodTypeAny): z.ZodTypeAny =>
  schema instanceof z.ZodDefault ? (schema.unwrap() as z.ZodTypeAny) : schema;

export const farmerListingPatchSchema = z
  .strictObject(
    Object.fromEntries(
      Object.entries(listingFields).map(([k, v]) => [
        k,
        withoutDefault(v as z.ZodTypeAny).optional(),
      ]),
    ) as { [K in keyof typeof listingFields]: z.ZodOptional<(typeof listingFields)[K]> },
  )
  .superRefine((value, ctx) => {
    if (Object.values(value).every((v) => v === undefined)) {
      ctx.addIssue({ code: 'custom', path: [], message: BUYER_MESSAGES.profileChangesNothing });
    }
  });

// ---------------------------------------------------------------------------
// A FARMER'S ANSWER TO A BUYER -- PATCH /api/farmer/requests/:id
// ---------------------------------------------------------------------------

export const farmerRequestAnswerSchema = z.strictObject({
  answer: z.enum(['accept', 'decline'], { error: () => M.answerUnknown }),
  note: optionalText(500),
});
export type FarmerRequestAnswer = z.infer<typeof farmerRequestAnswerSchema>;
