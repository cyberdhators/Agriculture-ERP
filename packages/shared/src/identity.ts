import { z } from 'zod';

import { parseSouthSudanMobile, phoneSchema } from './phone';

/**
 * Identity, roles and scope. Unit B3, criteria C-3.1 to C-3.9.
 */

// ---------------------------------------------------------------------------
// THE DERIVED AUTHENTICATION IDENTIFIER
// ---------------------------------------------------------------------------

/**
 * RFC 2606 reserves `.invalid` permanently. No mail can ever be delivered here,
 * and no future owner can register it.
 */
export const OFFICER_AUTH_DOMAIN = 'officers.invalid';

/**
 * THE ONE PLACE an officer's phone number becomes an authentication identifier.
 *
 * Officers type a phone number and a password, exactly as C-3.7 requires.
 * Supabase's Phone provider is disabled on this project and enabling it needs an
 * SMS provider from a fixed list that does not include Africa's Talking, our
 * contracted provider. So the phone addresses the auth system through this
 * function instead. Full reasoning in docs/DECISIONS.md.
 *
 * WHY EXACTLY ONE FUNCTION. GoTrue stores a phone with the leading plus
 * stripped; `phoneSchema` produces it. Two representations of one number, in two
 * systems, is how a lookup silently finds nothing and an officer is told their
 * password is wrong. Only this derivation ever addresses the auth system, so the
 * two cannot disagree.
 *
 * Every accepted written form resolves here to the same identifier:
 * `0912345678`, `+211912345678` and `211912345678` are one account.
 *
 * NEVER typed by a human, NEVER displayed, NEVER in an error message. It is an
 * authentication detail, not an address, and it is not a field of the officer —
 * the officer row stores the real E.164 phone.
 */
export function officerAuthIdentifier(phone: string): string {
  const parsed = parseSouthSudanMobile(phone);
  if (!parsed.ok) {
    // Callers validate with phoneSchema first. This is the guard against a code
    // path that forgot: it must never produce an identifier from a number the
    // rest of the system would reject, or two officers could collide.
    throw new Error('officerAuthIdentifier requires a valid South Sudan mobile number');
  }
  // parsed.value is +211XXXXXXXXX. The local part carries no plus, so the
  // identifier is stable regardless of how the number was written.
  return `officer.${parsed.value.slice(1)}@${OFFICER_AUTH_DOMAIN}`;
}

// ---------------------------------------------------------------------------
// ROLES AND SCOPE
// ---------------------------------------------------------------------------

export const USER_ROLES = ['admin', 'supervisor', 'read_only'] as const;
export const ALL_ROLES = [...USER_ROLES, 'officer'] as const;

export type UserRole = (typeof USER_ROLES)[number];
export type Role = (typeof ALL_ROLES)[number];

export const userRoleSchema = z.enum(USER_ROLES);

/**
 * What a principal may see. Resolved once by requireRole and passed to the
 * route; a route never works it out again.
 *
 * A null scope never means "everything" — C-3 notes. `all` is reachable only by
 * an admin, and the database refuses a supervisor or read_only row without a
 * state.
 */
export type Scope =
  | { readonly kind: 'all' }
  | { readonly kind: 'state'; readonly stateId: string }
  /**
   * An officer's caseload is the records THEY registered — not their payam.
   * payamId is here so an officer can only CREATE in their own payam; it is not
   * a reading permission. C-3.4.
   */
  | {
      readonly kind: 'caseload';
      readonly officerId: string;
      readonly payamId: string;
      readonly stateId: string;
    };

/** Roles that may write. read_only reads within its state and writes nothing (C-3.9). */
export const WRITING_ROLES: readonly Role[] = ['admin', 'supervisor', 'officer'];

export const canWrite = (role: Role): boolean => WRITING_ROLES.includes(role);

// ---------------------------------------------------------------------------
// REQUEST SCHEMAS
// ---------------------------------------------------------------------------

export const IDENTITY_MESSAGES = {
  nameRequired: 'Enter a name.',
  passwordTooShort: 'A password must be at least 12 characters.',
  emailInvalid: 'Enter a valid email address.',
  stateRequiredForRole: 'A supervisor or read-only account must be given a state.',
  stateForbiddenForAdmin: 'An administrator account cannot be limited to one state.',
} as const;

/** Long rather than complex: length is the property that resists guessing. */
export const passwordSchema = z
  .string({ error: () => IDENTITY_MESSAGES.passwordTooShort })
  .min(12, IDENTITY_MESSAGES.passwordTooShort);

export const personNameSchema = z
  .string({ error: () => IDENTITY_MESSAGES.nameRequired })
  .trim()
  .min(1, IDENTITY_MESSAGES.nameRequired);

const emailSchema = z
  .string({ error: () => IDENTITY_MESSAGES.emailInvalid })
  .trim()
  .email(IDENTITY_MESSAGES.emailInvalid);

export const createUserSchema = z
  .strictObject({
    name: personNameSchema,
    email: emailSchema,
    password: passwordSchema,
    role: userRoleSchema,
    state_id: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    // The same rule the database enforces, reported as a field error rather
    // than a constraint violation. C-3.4.
    if (value.role === 'admin' && value.state_id !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['state_id'],
        message: IDENTITY_MESSAGES.stateForbiddenForAdmin,
      });
    }
    if (value.role !== 'admin' && value.state_id === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['state_id'],
        message: IDENTITY_MESSAGES.stateRequiredForRole,
      });
    }
  });

export const createOfficerSchema = z.strictObject({
  name: personNameSchema,
  phone: phoneSchema,
  password: passwordSchema,
  payam_id: z.string(),
});

export const patchUserSchema = z.strictObject({
  name: personNameSchema.optional(),
  role: userRoleSchema.optional(),
  state_id: z.string().nullable().optional(),
  password: passwordSchema.optional(),
});

export const patchOfficerSchema = z.strictObject({
  name: personNameSchema.optional(),
  payam_id: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  password: passwordSchema.optional(),
});

export type CreateUser = z.infer<typeof createUserSchema>;
export type CreateOfficer = z.infer<typeof createOfficerSchema>;
export type PatchUser = z.infer<typeof patchUserSchema>;
export type PatchOfficer = z.infer<typeof patchOfficerSchema>;
