import { z } from 'zod';

/**
 * South Sudan mobile numbers.
 *
 * Country code +211, followed by exactly nine national digits. Accepted in
 * several written forms and normalised to E.164 (+211XXXXXXXXX), which is the
 * only form stored or returned. See docs/api/CONVENTIONS.md section 7.
 *
 * The Flutter officer app implements its own phone check in Dart for offline
 * feedback. It is a convenience, not a guarantee, and keeping it aligned with
 * this file is a manual obligation -- see CONVENTIONS.md section 8.
 */

const COUNTRY_CODE = '211';
const NATIONAL_DIGITS = 9;

export const PHONE_MESSAGES = {
  required: 'Enter a mobile number.',
  letters: 'A mobile number contains digits only.',
  punctuation: 'A mobile number may contain only digits, spaces and hyphens, and may begin with +.',
  wrongCountry: 'Enter a South Sudan mobile number starting +211.',
  tooFew: 'A South Sudan mobile number has nine digits after +211. This one has too few.',
  tooMany: 'A South Sudan mobile number has nine digits after +211. This one has too many.',
} as const;

export type PhoneParseResult =
  { readonly ok: true; readonly value: string } | { readonly ok: false; readonly message: string };

/**
 * Parses one written phone number into E.164, or explains why it cannot be.
 *
 * Exported so the failure reasons can be tested directly, and so a future Dart
 * port has a single readable definition to mirror.
 */
export function parseSouthSudanMobile(raw: string): PhoneParseResult {
  const trimmed = raw.trim();

  if (trimmed === '') {
    return { ok: false, message: PHONE_MESSAGES.required };
  }
  if (/[A-Za-z]/.test(trimmed)) {
    return { ok: false, message: PHONE_MESSAGES.letters };
  }
  // Digits, spaces and hyphens, with an optional leading plus. A plus anywhere
  // else fails here rather than being silently stripped.
  if (!/^\+?[0-9 -]+$/.test(trimmed)) {
    return { ok: false, message: PHONE_MESSAGES.punctuation };
  }

  const compact = trimmed.replace(/[ -]/g, '');

  let national: string;
  if (compact.startsWith('+')) {
    const digits = compact.slice(1);
    if (!digits.startsWith(COUNTRY_CODE)) {
      return { ok: false, message: PHONE_MESSAGES.wrongCountry };
    }
    national = digits.slice(COUNTRY_CODE.length);
  } else if (compact.startsWith(COUNTRY_CODE)) {
    national = compact.slice(COUNTRY_CODE.length);
  } else if (compact.startsWith('0')) {
    national = compact.slice(1);
  } else {
    return { ok: false, message: PHONE_MESSAGES.wrongCountry };
  }

  if (national.length < NATIONAL_DIGITS) {
    return { ok: false, message: PHONE_MESSAGES.tooFew };
  }
  if (national.length > NATIONAL_DIGITS) {
    return { ok: false, message: PHONE_MESSAGES.tooMany };
  }

  return { ok: true, value: `+${COUNTRY_CODE}${national}` };
}

/**
 * A South Sudan mobile number, normalised to E.164 on success.
 */
export const phoneSchema = z
  .string({ error: () => PHONE_MESSAGES.required })
  .transform((value, ctx) => {
    const result = parseSouthSudanMobile(value);
    if (!result.ok) {
      ctx.addIssue({ code: 'custom', message: result.message });
      return z.NEVER;
    }
    return result.value;
  });
