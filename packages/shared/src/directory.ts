import { z } from 'zod';

import { locationCodeSchema } from './location';
import { phoneSchema } from './phone';

/**
 * The three directories: agro-dealer (i), input supplier (j), financial
 * service (k). Unit P1, criteria C-13.1 to C-13.5.
 *
 * One typed entry, per docs/data-model-extension.md section 3. A directory
 * entry is a named place with a phone number that a farmer can be sent to. It
 * is never an account: no balance, no loan, no transaction. If a field here
 * starts to look like one, stop and ask.
 *
 * These schemas validate what an administrator submits through the web portal.
 * The same schema runs on the client, so a form and the API cannot disagree
 * about what is valid (CLAUDE.md, Validation).
 */

export const DIRECTORY_ENTRY_TYPES = ['agro_dealer', 'input_supplier', 'financial_service'] as const;

export const FINANCIAL_PROVIDER_CLASSES = [
  'bank',
  'microfinance',
  'mobile_money',
  'cooperative_sacco',
  'other',
] as const;

export const DIRECTORY_LIMITS = {
  nameMax: 200,
  descriptionMax: 2000,
  serviceMax: 60,
  servicesMax: 20,
  contactNameMax: 120,
  addressMax: 500,
} as const;

export const DIRECTORY_MESSAGES = {
  typeUnknown: 'An entry is an agro-dealer, an input supplier or a financial service.',
  nameRequired: 'Enter a name.',
  nameBlank: 'A name cannot be only spaces.',
  nameTooLong: `A name has at most ${DIRECTORY_LIMITS.nameMax} characters.`,
  descriptionTooLong: `A description has at most ${DIRECTORY_LIMITS.descriptionMax} characters.`,
  serviceBlank: 'A service cannot be empty.',
  serviceTooLong: `A service name has at most ${DIRECTORY_LIMITS.serviceMax} characters.`,
  servicesTooMany: `List at most ${DIRECTORY_LIMITS.servicesMax} services.`,
  servicesDuplicate: 'Each service may be listed once.',
  contactNameTooLong: `A contact name has at most ${DIRECTORY_LIMITS.contactNameMax} characters.`,
  emailInvalid: 'Enter a valid email address, or leave it empty.',
  addressTooLong: `An address has at most ${DIRECTORY_LIMITS.addressMax} characters.`,
  latitudeRange: 'Latitude is between -90 and 90.',
  longitudeRange: 'Longitude is between -180 and 180.',
  providerClassUnknown:
    'A financial service is a bank, microfinance, mobile money, a cooperative or SACCO, or other.',
  providerClassRequired: 'Say what kind of financial service this is.',
  providerClassNotAllowed: 'Only a financial service has a provider class.',
  verifiedDateRequired: 'Enter the date this entry was last checked.',
  verifiedDateFormat: 'Enter the date as YYYY-MM-DD.',
  verifiedDateFuture: 'The date this entry was last checked cannot be in the future.',
} as const;

/** A calendar date as YYYY-MM-DD, and a real one: 2026-02-30 is refused. */
const isoDateSchema = z
  .string({ error: () => DIRECTORY_MESSAGES.verifiedDateRequired })
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, DIRECTORY_MESSAGES.verifiedDateFormat)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, DIRECTORY_MESSAGES.verifiedDateFormat);

/**
 * Today, in UTC, as YYYY-MM-DD. A parameter rather than a call to Date.now()
 * inside the schema so that tests are not tied to the clock.
 */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

const optionalText = (max: number, tooLong: string) =>
  z
    .string()
    .trim()
    .max(max, tooLong)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

/**
 * A point, as the web form and the phone supply it. Stored as PostGIS
 * geography by raw SQL in the route; this is the shape before that.
 */
export const geoPointSchema = z.strictObject({
  latitude: z.number().min(-90, DIRECTORY_MESSAGES.latitudeRange).max(90, DIRECTORY_MESSAGES.latitudeRange),
  longitude: z
    .number()
    .min(-180, DIRECTORY_MESSAGES.longitudeRange)
    .max(180, DIRECTORY_MESSAGES.longitudeRange),
});

const servicesSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1, DIRECTORY_MESSAGES.serviceBlank)
      .max(DIRECTORY_LIMITS.serviceMax, DIRECTORY_MESSAGES.serviceTooLong),
  )
  .max(DIRECTORY_LIMITS.servicesMax, DIRECTORY_MESSAGES.servicesTooMany)
  .default([])
  .refine(
    (list) => new Set(list.map((s) => s.toLocaleLowerCase())).size === list.length,
    DIRECTORY_MESSAGES.servicesDuplicate,
  );

/**
 * Builds the input schema against a given "today", so that "not in the future"
 * is testable. Routes call `directoryEntryInputSchema()` with no argument.
 */
export function directoryEntryInputSchema(today: string = todayIso()) {
  return z
    .strictObject({
      entry_type: z.enum(DIRECTORY_ENTRY_TYPES, { error: () => DIRECTORY_MESSAGES.typeUnknown }),
      name: z
        .string({ error: () => DIRECTORY_MESSAGES.nameRequired })
        .trim()
        .min(1, DIRECTORY_MESSAGES.nameBlank)
        .max(DIRECTORY_LIMITS.nameMax, DIRECTORY_MESSAGES.nameTooLong),
      description: optionalText(DIRECTORY_LIMITS.descriptionMax, DIRECTORY_MESSAGES.descriptionTooLong),
      services: servicesSchema,
      contact_name: optionalText(DIRECTORY_LIMITS.contactNameMax, DIRECTORY_MESSAGES.contactNameTooLong),
      phone: phoneSchema,
      alt_phone: phoneSchema.nullable().optional(),
      email: z
        .string()
        .trim()
        .transform((value) => (value === '' ? null : value))
        .pipe(z.email({ error: () => DIRECTORY_MESSAGES.emailInvalid }).nullable())
        .nullable()
        .optional(),
      physical_address: optionalText(DIRECTORY_LIMITS.addressMax, DIRECTORY_MESSAGES.addressTooLong),
      location: geoPointSchema.nullable().optional(),
      payam_id: locationCodeSchema,
      state_id: locationCodeSchema,
      provider_class: z
        .enum(FINANCIAL_PROVIDER_CLASSES, { error: () => DIRECTORY_MESSAGES.providerClassUnknown })
        .nullable()
        .optional(),
      last_verified_at: isoDateSchema.refine(
        (value) => value <= today,
        DIRECTORY_MESSAGES.verifiedDateFuture,
      ),
      active: z.boolean().default(true),
    })
    .superRefine((entry, ctx) => {
      // Mirrors the CHECK constraint directory_entry_provider_class_matches_type:
      // required for a financial service, forbidden for anything else.
      const isFinancial = entry.entry_type === 'financial_service';
      const hasClass = entry.provider_class != null;
      if (isFinancial && !hasClass) {
        ctx.addIssue({
          code: 'custom',
          path: ['provider_class'],
          message: DIRECTORY_MESSAGES.providerClassRequired,
        });
      }
      if (!isFinancial && hasClass) {
        ctx.addIssue({
          code: 'custom',
          path: ['provider_class'],
          message: DIRECTORY_MESSAGES.providerClassNotAllowed,
        });
      }
    });
}

export type DirectoryEntryType = (typeof DIRECTORY_ENTRY_TYPES)[number];
export type FinancialProviderClass = (typeof FINANCIAL_PROVIDER_CLASSES)[number];
export type DirectoryEntryInput = z.infer<ReturnType<typeof directoryEntryInputSchema>>;
export type GeoPoint = z.infer<typeof geoPointSchema>;
