import { parseSouthSudanMobile, type Crop, type Language } from '@agri-erp/shared';

/**
 * Farmer registration validation.
 *
 * TO MOVE TO packages/shared WHEN C-5 IS WRITTEN. The registration deliverable
 * (C-5) has not landed, and `zod` is not resolvable from this app in the
 * workspace as it stands, so this validator is composed by hand here from the
 * shared primitives it can reach — the phone parser above, and the CROP /
 * LANGUAGE enums. It mirrors the field rules a Zod schema would carry so the
 * screen can validate on blur and on submit against the same law the server
 * will eventually enforce. It is deliberately the ONLY validation the farmer
 * form trusts; the browser's own `required`/`min` are hints, not the check.
 */

export type Sex = 'f' | 'm';
export type RegistrationSource = 'officer' | 'self';

export interface FarmerFormValues {
  given_name: string;
  family_name: string;
  sex: Sex | '';
  year_of_birth: string;
  phone: string;
  national_id: string;
  state_id: string;
  county_id: string;
  payam_id: string;
  registration_source: RegistrationSource | '';
  consent_language: Language | '';
  consent_granted: boolean;
  /**
   * The account password, created at registration (B12 point 2): by the farmer
   * on the self-registration form, or by the officer as the initial password on
   * the intake form. Optional in the shape so older callers and fixtures need
   * not carry one; a form that creates an account passes `requirePassword`.
   */
  password?: string;
}

export interface ParsedFarmer {
  given_name: string;
  family_name: string;
  sex: Sex;
  year_of_birth: number;
  phone: string;
  national_id: string | null;
  state_id: string;
  county_id: string;
  payam_id: string;
  registration_source: RegistrationSource;
  consent_language: Language;
  consent_granted: true;
  password: string | null;
}

export type FarmerErrors = Partial<Record<keyof FarmerFormValues, string>>;

export type FarmerParseResult =
  | { readonly ok: true; readonly values: ParsedFarmer }
  | {
      readonly ok: false;
      readonly errors: FarmerErrors;
      readonly firstInvalid: keyof FarmerFormValues;
    };

/** Youngest a lead farmer may be, in years. */
export const MIN_AGE = 12;
/** Earliest plausible year of birth the form will accept. */
export const MIN_YEAR = 1920;

export function maxBirthYear(now: Date = new Date()): number {
  return now.getUTCFullYear() - MIN_AGE;
}

/**
 * Password rule (B12 point 2): at least six characters and nothing else — no
 * composition rule, because farmers sign in from feature phones and many are
 * new to reading. The sentence is the one the form shows.
 */
export const PASSWORD_MIN = 6;
export const PASSWORD_RULE = `Choose ${PASSWORD_MIN} or more characters you will remember.`;

export function validatePassword(value: string): string | undefined {
  if (value.length === 0) return 'Enter a password.';
  if (value.length < PASSWORD_MIN) return PASSWORD_RULE;
  return undefined;
}

const NAME_MAX = 80;
const NAME_MESSAGES = {
  given: 'Enter the given name.',
  family: 'Enter the family name.',
  tooLong: `Keep names to ${NAME_MAX} characters.`,
} as const;

/** National id is optional; when present it is a light format check only. */
const NATIONAL_ID_RE = /^[A-Za-z0-9-]{4,20}$/;

// Ordered so the error summary and focus target follow the visual order.
const FIELD_ORDER: readonly (keyof FarmerFormValues)[] = [
  'given_name',
  'family_name',
  'sex',
  'year_of_birth',
  'phone',
  'national_id',
  'state_id',
  'county_id',
  'payam_id',
  'password',
  'registration_source',
  'consent_language',
  'consent_granted',
];

export interface ValidateFarmerOptions {
  /** The form creates an account, so the password is required, not optional. */
  requirePassword?: boolean;
}

export function validateFarmer(
  input: FarmerFormValues,
  now: Date = new Date(),
  options: ValidateFarmerOptions = {},
): FarmerParseResult {
  const errors: FarmerErrors = {};

  const given = input.given_name.trim();
  if (given === '') errors.given_name = NAME_MESSAGES.given;
  else if (given.length > NAME_MAX) errors.given_name = NAME_MESSAGES.tooLong;

  const family = input.family_name.trim();
  if (family === '') errors.family_name = NAME_MESSAGES.family;
  else if (family.length > NAME_MAX) errors.family_name = NAME_MESSAGES.tooLong;

  if (input.sex !== 'f' && input.sex !== 'm') errors.sex = 'Select female or male.';

  const yobRaw = input.year_of_birth.trim();
  const ceiling = maxBirthYear(now);
  if (yobRaw === '') {
    errors.year_of_birth = 'Enter the year of birth.';
  } else if (!/^\d{4}$/.test(yobRaw)) {
    errors.year_of_birth = 'Enter the year as four digits, for example 1994.';
  } else {
    const yob = Number(yobRaw);
    if (yob < MIN_YEAR) errors.year_of_birth = `Year of birth cannot be before ${MIN_YEAR}.`;
    else if (yob > ceiling)
      errors.year_of_birth = `A lead farmer is at least ${MIN_AGE}; year of birth cannot be after ${ceiling}.`;
  }

  const phoneResult = parseSouthSudanMobile(input.phone);
  if (!phoneResult.ok) errors.phone = phoneResult.message;

  const nid = input.national_id.trim();
  if (nid !== '' && !NATIONAL_ID_RE.test(nid))
    errors.national_id = 'A national id is 4–20 letters, digits or hyphens. Leave blank if none.';

  if (input.state_id.trim() === '') errors.state_id = 'Select a state.';
  if (input.county_id.trim() === '') errors.county_id = 'Select a county.';
  if (input.payam_id.trim() === '') errors.payam_id = 'Select a payam.';

  const password = input.password ?? '';
  if (options.requirePassword || password !== '') {
    const passwordError = validatePassword(password);
    if (passwordError) errors.password = passwordError;
  }

  if (input.registration_source !== 'officer' && input.registration_source !== 'self')
    errors.registration_source = 'Record how the farmer was registered.';

  if (input.consent_language !== 'en' && input.consent_language !== 'ar')
    errors.consent_language = 'Select the language the consent was read in.';

  if (!input.consent_granted)
    errors.consent_granted = 'Consent must be given before a farmer can be registered.';

  const firstInvalid = FIELD_ORDER.find((f) => errors[f]);
  if (firstInvalid) return { ok: false, errors, firstInvalid };

  return {
    ok: true,
    values: {
      given_name: given,
      family_name: family,
      sex: input.sex as Sex,
      year_of_birth: Number(yobRaw),
      phone: phoneResult.ok ? phoneResult.value : input.phone,
      national_id: nid === '' ? null : nid,
      state_id: input.state_id,
      county_id: input.county_id,
      payam_id: input.payam_id,
      registration_source: input.registration_source as RegistrationSource,
      consent_language: input.consent_language as Language,
      consent_granted: true,
      password: password === '' ? null : password,
    },
  };
}

export type { Crop };
