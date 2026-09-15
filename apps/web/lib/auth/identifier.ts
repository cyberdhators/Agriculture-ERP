import { officerAuthIdentifier, parseSouthSudanMobile } from '@agri-erp/shared';

/**
 * What the sign-in form sends to Supabase Auth as the account identifier.
 *
 * Staff accounts are keyed by the email an administrator entered. Extension
 * officers authenticate by phone number and password (C-3.7), but the Phone
 * provider is disabled on this project (DECISIONS, B3), so an officer's auth
 * account is keyed by an identifier derived from the phone — the same
 * function POST /api/officers used to create it. The officer types their
 * number, in any of the forms the shared parser accepts; the form derives the
 * identifier and never shows it.
 *
 * Anything that is neither an email nor a South Sudan mobile is passed through
 * unchanged, so Supabase refuses it and the form shows the one generic error.
 */
export function loginIdentifier(input: string): string {
  const trimmed = input.trim();
  if (trimmed.includes('@')) return trimmed;
  const phone = parseSouthSudanMobile(trimmed);
  return phone.ok ? officerAuthIdentifier(phone.value) : trimmed;
}
