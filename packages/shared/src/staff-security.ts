import { z } from 'zod';

import { IDENTITY_MESSAGES, passwordSchema, personNameSchema, userRoleSchema } from './identity';

/**
 * STAFF SECURITY (2026-10-28, lane-security). CORWADO's specification of 16
 * October: "require strong staff authentication and support immediate session
 * revocation"; "Invitations, multiple roles ..."; "Record account creation,
 * first successful sign-in, subsequent sign-ins, return sessions, last
 * activity and failed sign-ins". docs/DECISIONS.md, the 2026-10-28 entries.
 *
 * Everything here is pure: the MFA gate, the sign-in rate rule, the activity
 * throttle and the schemas. The routes load facts and ask these functions;
 * the tests ask them directly.
 */

// ---------------------------------------------------------------------------
// TWO-STEP SIGN-IN (TOTP) FOR STAFF
// ---------------------------------------------------------------------------

/**
 * How strictly two-step sign-in is enforced, from STAFF_MFA_ENFORCEMENT.
 *
 *   off       nothing is checked (the emergency switch; never the default)
 *   verify    THE DEFAULT. Any staff account that HAS an authenticator must
 *             use it: a session that has not passed the code step is refused
 *             everywhere except the few routes that let it finish signing in.
 *             An administrator WITHOUT one is let through, but the portal
 *             sends them to set one up before anything else.
 *   required  as verify, and an administrator without an authenticator is
 *             refused everywhere except those same routes, until they set one
 *             up. Switched on once CORWADO's administrators have enrolled.
 *
 * Why a rollout and not a switch: the only database is production, and an
 * administrator refused by a broken enrolment screen could not reach the
 * screen that would fix it. "verify" never refuses anyone who has not chosen
 * to enrol, so it cannot lock CORWADO out; "required" is a deliberate step.
 */
export const STAFF_MFA_MODES = ['off', 'verify', 'required'] as const;
export type StaffMfaMode = (typeof STAFF_MFA_MODES)[number];

/** Unset or unrecognised reads as the safe default, never as "off". */
export function staffMfaMode(raw: string | undefined | null): StaffMfaMode {
  const value = (raw ?? '').trim().toLowerCase();
  return (STAFF_MFA_MODES as readonly string[]).includes(value)
    ? (value as StaffMfaMode)
    : 'verify';
}

/** What the session says about its two-step state. */
export interface MfaFacts {
  /** A staff role from requireRole: admin, supervisor or read_only. */
  readonly role: string;
  /** The account has at least one VERIFIED authenticator factor. */
  readonly hasVerifiedFactor: boolean;
  /** The session's assurance level: aal2 once the code step was passed. */
  readonly aal: 'aal1' | 'aal2' | null;
}

export type MfaGate = 'ok' | 'verify_required' | 'enrolment_required';

/**
 * THE GATE requireRole asks for every staff session. `exempt` is true only on
 * the routes a session needs to finish signing in or to enrol (GET /api/me and
 * the /api/staff/mfa routes): without them the refusal could not be cured.
 */
export function staffMfaGate(facts: MfaFacts, mode: StaffMfaMode, exempt: boolean): MfaGate {
  if (mode === 'off' || exempt) return 'ok';
  if (facts.hasVerifiedFactor) return facts.aal === 'aal2' ? 'ok' : 'verify_required';
  if (mode === 'required' && facts.role === 'admin') return 'enrolment_required';
  return 'ok';
}

/** What GET /api/me reports to the portal about the caller's two-step state. */
export interface StaffMfaStatus {
  readonly mode: StaffMfaMode;
  /** Has a verified authenticator. */
  readonly enrolled: boolean;
  /** This session has passed the code step. */
  readonly session_verified: boolean;
  /** The portal must send them to the code step before anything else. */
  readonly verify_now: boolean;
  /** The portal must send them to set up an authenticator before anything else. */
  readonly enrol_now: boolean;
}

export function staffMfaStatus(facts: MfaFacts, mode: StaffMfaMode): StaffMfaStatus {
  const enrolled = facts.hasVerifiedFactor;
  const sessionVerified = facts.aal === 'aal2';
  return {
    mode,
    enrolled,
    session_verified: sessionVerified,
    verify_now: mode !== 'off' && enrolled && !sessionVerified,
    // Administrators are sent to enrol in "verify" mode too: that is the
    // rollout. Only "required" also refuses them on the server.
    enrol_now: mode !== 'off' && !enrolled && facts.role === 'admin',
  };
}

/**
 * The `aal` claim of an access token that the sign-in service has ALREADY
 * validated (requireRole calls this only after getUser accepted the token).
 * Decoding here proves nothing about the token by itself; it reads one claim
 * from a token that is known to be genuine. Anything unreadable is null,
 * which the gate treats as "not verified".
 */
export function aalOfToken(token: string | null | undefined): 'aal1' | 'aal2' | null {
  if (!token) return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json =
      typeof atob === 'function'
        ? atob(padded)
        : // Node without atob (older runtimes): Buffer is always present there.
          (globalThis as { Buffer?: { from(s: string, e: string): { toString(e: string): string } } })
            .Buffer!.from(padded, 'base64')
            .toString('binary');
    const claims = JSON.parse(json) as { aal?: unknown };
    return claims.aal === 'aal1' || claims.aal === 'aal2' ? claims.aal : null;
  } catch {
    return null;
  }
}

export const STAFF_MFA_MESSAGES = {
  codeShape: 'Enter the six-digit code from your authenticator app.',
  confirmRequired: 'Tick the box to confirm.',
  reasonRequired: 'Give a reason of at least five characters. It is kept in the audit trail.',
  reasonTooLong: 'Keep the reason under 500 characters.',
  passwordRequired: 'Enter your own password to confirm.',
} as const;

/** POST /api/admin/staff-access/users/:id/mfa-reset -- re-authenticated, recorded. */
export const mfaResetSchema = z.strictObject({
  reason: z
    .string({ error: () => STAFF_MFA_MESSAGES.reasonRequired })
    .trim()
    .min(5, STAFF_MFA_MESSAGES.reasonRequired)
    .max(500, STAFF_MFA_MESSAGES.reasonTooLong),
  password: z
    .string({ error: () => STAFF_MFA_MESSAGES.passwordRequired })
    .min(1, STAFF_MFA_MESSAGES.passwordRequired)
    .max(256, STAFF_MFA_MESSAGES.passwordRequired),
  totp_code: z.string().trim().regex(/^\d{6}$/, STAFF_MFA_MESSAGES.codeShape).optional(),
  confirm: z.literal(true, { error: () => STAFF_MFA_MESSAGES.confirmRequired }),
});
export type MfaResetInput = z.infer<typeof mfaResetSchema>;

/** The six-digit code the enrolment and verify screens send to Supabase. Client-side. */
export const totpCodeSchema = z
  .string({ error: () => STAFF_MFA_MESSAGES.codeShape })
  .trim()
  .regex(/^\d{6}$/, STAFF_MFA_MESSAGES.codeShape);

// ---------------------------------------------------------------------------
// SIGN-IN THROUGH THE SERVER: FAILED SIGN-INS AND THE RATE LIMIT
// ---------------------------------------------------------------------------

export const SIGN_IN_MESSAGES = {
  identifierRequired: 'Enter your email address or phone number.',
  passwordRequired: 'Enter your password.',
} as const;

/**
 * POST /api/auth/sign-in. `identifier` is the value Supabase Auth knows the
 * account by -- an email address, or the identifier DERIVED from a phone
 * number on the device (lib/auth/identifier.ts, farmerAuthIdentifier). The
 * password is never logged, stored or audited.
 */
export const signInRequestSchema = z.strictObject({
  identifier: z
    .string({ error: () => SIGN_IN_MESSAGES.identifierRequired })
    .trim()
    .min(3, SIGN_IN_MESSAGES.identifierRequired)
    .max(254, SIGN_IN_MESSAGES.identifierRequired)
    .transform((v) => v.toLowerCase()),
  password: z
    .string({ error: () => SIGN_IN_MESSAGES.passwordRequired })
    .min(1, SIGN_IN_MESSAGES.passwordRequired)
    .max(256, SIGN_IN_MESSAGES.passwordRequired),
});
export type SignInRequest = z.infer<typeof signInRequestSchema>;

/** What the sign-in route answers. Never says whether the identifier exists. */
export type SignInOutcome =
  | { readonly signed_in: true; readonly mfa_required: boolean }
  | { readonly signed_in: false; readonly reason: 'wrong' | 'suspended' };

/**
 * THE RATE RULE. Per identifier: five failed attempts inside fifteen minutes
 * and the next attempt is refused without asking the sign-in service, until
 * the oldest of them leaves the window. Per server instance, a coarser brake
 * on everything arriving from one network address (never stored).
 *
 * A refusal is the same for an identifier that exists and one that does not,
 * so the limit itself tells nobody which addresses have accounts.
 */
export const SIGN_IN_LIMITS = {
  windowMs: 15 * 60 * 1000,
  maxFailuresPerIdentifier: 5,
  /** Attempts from one address per window, per server instance. */
  maxAttemptsPerAddress: 30,
  /** Attempts older than this are deleted opportunistically. */
  keepMs: 24 * 60 * 60 * 1000,
} as const;

/**
 * Whether another attempt may be made, and if not, how long until it may.
 * Only failures AFTER the identifier's latest success count: signing in
 * correctly clears the slate.
 */
export function signInRateDecision(input: {
  readonly attempts: readonly { readonly atMs: number; readonly succeeded: boolean }[];
  readonly nowMs: number;
}): { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number } {
  const since = input.nowMs - SIGN_IN_LIMITS.windowMs;
  const lastSuccess = Math.max(
    -Infinity,
    ...input.attempts.filter((a) => a.succeeded).map((a) => a.atMs),
  );
  const recent = input.attempts
    .filter((a) => !a.succeeded && a.atMs > since && a.atMs > lastSuccess)
    .map((a) => a.atMs)
    .sort((a, b) => a - b);
  if (recent.length < SIGN_IN_LIMITS.maxFailuresPerIdentifier) return { allowed: true };
  // The failure that must leave the window before one more is allowed.
  const pivot = recent[recent.length - SIGN_IN_LIMITS.maxFailuresPerIdentifier]!;
  const waitMs = pivot + SIGN_IN_LIMITS.windowMs - input.nowMs;
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
}

// ---------------------------------------------------------------------------
// LAST ACTIVITY ON EVERY API CALL, THROTTLED
// ---------------------------------------------------------------------------

/**
 * "Last activity" moves on any authenticated API call, not only on a page
 * load, but at most once per account per five minutes: a busy screen making
 * forty calls a minute writes one row update, not forty.
 */
export const ACTIVITY_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export const shouldTouchActivity = (lastTouchedMs: number | undefined, nowMs: number): boolean =>
  lastTouchedMs === undefined || nowMs - lastTouchedMs >= ACTIVITY_TOUCH_INTERVAL_MS;

// ---------------------------------------------------------------------------
// STAFF INVITATIONS
// ---------------------------------------------------------------------------

/** Seven days to accept; then the link stops working and a new one is sent. */
export const STAFF_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const STAFF_INVITATION_STATUSES = ['pending', 'expired', 'accepted', 'revoked'] as const;
export type StaffInvitationStatus = (typeof STAFF_INVITATION_STATUSES)[number];

export function staffInvitationStatus(
  row: {
    readonly accepted_at: Date | string | null;
    readonly revoked_at: Date | string | null;
    readonly expires_at: Date | string;
  },
  nowMs: number,
): StaffInvitationStatus {
  if (row.accepted_at) return 'accepted';
  if (row.revoked_at) return 'revoked';
  return new Date(row.expires_at).getTime() <= nowMs ? 'expired' : 'pending';
}

const invitationEmail = z
  .string({ error: () => IDENTITY_MESSAGES.emailInvalid })
  .trim()
  .toLowerCase()
  .email(IDENTITY_MESSAGES.emailInvalid)
  .max(254, IDENTITY_MESSAGES.emailInvalid);

/** POST /api/admin/staff-invitations. The same role/state rule as createUserSchema. */
export const staffInvitationSchema = z
  .strictObject({
    name: personNameSchema.pipe(z.string().max(100, IDENTITY_MESSAGES.nameRequired)),
    email: invitationEmail,
    role: userRoleSchema,
    state_id: z.string().trim().min(1).max(32).optional(),
  })
  .superRefine((value, ctx) => {
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
export type StaffInvitationInput = z.infer<typeof staffInvitationSchema>;

export const STAFF_INVITATION_MESSAGES = {
  tokenInvalid: 'This invitation link is not complete. Open the link from the email again.',
} as const;

/** The token in the link: 32 random bytes, base64url. Never stored; its hash is. */
export const staffInvitationTokenSchema = z
  .string({ error: () => STAFF_INVITATION_MESSAGES.tokenInvalid })
  .trim()
  .regex(/^[A-Za-z0-9_-]{43}$/, STAFF_INVITATION_MESSAGES.tokenInvalid);

/** POST /api/staff-invitations/accept -- the invitee chooses their own password. */
export const acceptStaffInvitationSchema = z.strictObject({
  token: staffInvitationTokenSchema,
  password: passwordSchema.pipe(z.string().max(256, IDENTITY_MESSAGES.passwordTooShort)),
});
export type AcceptStaffInvitationInput = z.infer<typeof acceptStaffInvitationSchema>;

/** One invitation as the staff list shows it. The token never leaves the server. */
export interface StaffInvitationView {
  id: string;
  name: string;
  /**
   * The address, MASKED ("a•••@example.org"). A full staff address is read
   * from the authentication store and nowhere else (lib/supabase/admin.ts);
   * the list does not start returning one.
   */
  email_hint: string;
  role: 'admin' | 'supervisor' | 'read_only';
  state_id: string | null;
  status: StaffInvitationStatus;
  invited_by_name: string | null;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  /** Whether the email was handed to the provider. False: copy the link instead. */
  email_sent?: boolean;
  /** Present ONLY in the answer to the create call, once: the link to pass on. */
  link?: string;
}

/** "a•••@example.org": the first character and the domain, nothing between. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '•••';
  return `${email[0]}•••${email.slice(at)}`;
}

/** POST /api/staff-invitations/preview { token } -- what the invitee sees before choosing a password. */
export interface StaffInvitationPreview {
  name: string;
  role: 'admin' | 'supervisor' | 'read_only';
  status: StaffInvitationStatus;
  expires_at: string;
  email_hint: string;
}

/** POST /api/staff-invitations/preview. */
export const previewStaffInvitationSchema = z.strictObject({ token: staffInvitationTokenSchema });
