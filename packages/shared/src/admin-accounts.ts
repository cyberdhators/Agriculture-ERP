import { z } from 'zod';

import { ACTIVITIES } from './account-profile';
import { type AccountStanding } from './moderation';

/**
 * USERS AND ORGANIZATIONS (2026-10-28). CORWADO's specification of 16 October
 * 2026, section 4: "Search by name/ID/contact as permitted; actor types,
 * organizations, joined date/time, first sign-in, last active,
 * account/verification/publication status. Contact, suspend, disable and
 * restore with reasons." And the infographic "Profile creation and
 * visibility", panel 4, "Authorized admin view": contact-verified flags,
 * masked private contact visible to authorised staff only, user activity,
 * staff actions.
 *
 * ONE LIST OF EVERY ACCOUNT. A row is a sign-in account (its farmer and buyer
 * records together -- one account, many activities), a farmer an officer
 * registered with no sign-in, or an organisational profile. Deleted accounts
 * are never listed: the deletion law ("soft-deleted rows must not appear in
 * any list, count, export or report").
 *
 * Pure: the filter, the masks, the status words. Served by GET
 * /api/admin/accounts and GET /api/admin/accounts/:kind/:id.
 */

/** Pinned in docs/api/CONVENTIONS.md §5.2.3. */
export const ADMIN_ACCOUNT_MESSAGES = {
  kindUnknown: 'Choose people or organisations.',
  signInUnknown: 'Choose yes or no.',
  actorUnknown: 'Choose an actor type from the list.',
  statusUnknown: 'Choose active, suspended, disabled or closed.',
  dateInvalid: 'Give the date as YYYY-MM-DD.',
  searchLength: 'Search with at most 100 characters.',
  contactFieldUnknown: 'Choose phone or email.',
} as const;

const M = ADMIN_ACCOUNT_MESSAGES;

export const ACCOUNT_LIST_KINDS = ['person', 'organisation'] as const;
export type AccountListKind = (typeof ACCOUNT_LIST_KINDS)[number];

/** active, suspended, disabled -- and closed for an organisation. */
export const ACCOUNT_STATUSES = ['active', 'suspended', 'disabled', 'closed'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const ACCOUNT_STATUS_LABELS: Readonly<Record<AccountStatus, string>> = {
  active: 'Account active',
  suspended: 'Suspended',
  disabled: 'Disabled',
  closed: 'Closed',
};

const date = z
  .string({ error: () => M.dateInvalid })
  .regex(/^\d{4}-\d{2}-\d{2}$/, M.dateInvalid)
  .refine((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)), M.dateInvalid);

/**
 * GET /api/admin/accounts (query). `state`, `actor`, `from`, `to`, `sign_in`
 * and `kind` are the names the Overview's tiles carry (admin-overview.ts).
 */
export const adminAccountFilterSchema = z.strictObject({
  q: z
    .string({ error: () => M.searchLength })
    .trim()
    .max(100, M.searchLength)
    .optional(),
  kind: z.enum(ACCOUNT_LIST_KINDS, { error: () => M.kindUnknown }).optional(),
  sign_in: z.enum(['yes', 'no'], { error: () => M.signInUnknown }).optional(),
  actor: z.enum(ACTIVITIES, { error: () => M.actorUnknown }).optional(),
  status: z.enum(ACCOUNT_STATUSES, { error: () => M.statusUnknown }).optional(),
  state: z.string().trim().max(20).optional(),
  from: date.optional(),
  to: date.optional(),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});
export type AdminAccountFilter = z.infer<typeof adminAccountFilterSchema>;

/** Revealing one private contact: which one. */
export const revealContactSchema = z.strictObject({
  field: z.enum(['phone', 'email'], { error: () => M.contactFieldUnknown }),
});
export type RevealContactInput = z.infer<typeof revealContactSchema>;

/** The kinds an account detail is addressed by: a record, or an organisation. */
export const ACCOUNT_DETAIL_KINDS = ['farmer', 'buyer', 'organisation'] as const;
export type AccountDetailKind = (typeof ACCOUNT_DETAIL_KINDS)[number];

/** How an account signs in: a phone (farmer side), an email (buyer only), or not at all. */
export type SignInMethod = 'phone' | 'email' | 'none';

/** The account's standing from its records. Disabled outranks suspended. */
export function accountStatusOf(r: {
  suspended_at: Date | string | null;
  disabled_at: Date | string | null;
  closed?: boolean;
}): AccountStatus {
  if (r.closed) return 'closed';
  if (r.disabled_at) return 'disabled';
  if (r.suspended_at) return 'suspended';
  return 'active';
}

/**
 * ADVISORY STATUS: what the account offers as advice. 'approved' -- an
 * approved adviser; 'applied' -- an application waiting; 'published' /
 * 'draft' -- an advice profile, no approval; 'none'.
 */
export type AdvisoryStatus = 'approved' | 'applied' | 'published' | 'draft' | 'none';

export const ADVISORY_STATUS_LABELS: Readonly<Record<AdvisoryStatus, string>> = {
  approved: 'Approved adviser',
  applied: 'Adviser application waiting',
  published: 'Advice profile published',
  draft: 'Advice profile draft',
  none: 'No advice profile',
};

/** Application statuses that are still waiting on a decision. */
const WAITING_APPLICATION = new Set(['submitted', 'clarification_requested']);

export function advisoryStatusOf(r: {
  provider_status: string | null;
  adviser_approved: boolean | null;
  application_status: string | null;
}): AdvisoryStatus {
  if (r.adviser_approved) return 'approved';
  if (r.application_status && WAITING_APPLICATION.has(r.application_status)) return 'applied';
  if (r.provider_status === 'published') return 'published';
  if (r.provider_status) return 'draft';
  return 'none';
}

/**
 * A private phone, masked: the country code and the last two digits.
 * "+211912345678" -> "+211 *** *** *78". Null stays null.
 */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  const tail = digits.slice(-2);
  return phone.startsWith('+211') ? `+211 *** *** *${tail}` : `*** *** *${tail}`;
}

/** A private email, masked: the first letter and the domain. "amina@x.org" -> "a*******@x.org". */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email[0]}${'*'.repeat(Math.max(3, at - 1))}${email.slice(at)}`;
}

/**
 * What a search box text may match, decided before any query: a record id
 * (a uuid), a farmer number, a phone (six or more digits -- only for staff
 * permitted to search by contact), or a name.
 */
export interface AccountSearch {
  readonly uuid: string | null;
  readonly digits: string | null;
  readonly text: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function accountSearch(q: string, mayUseContact: boolean): AccountSearch {
  const text = q.trim();
  const digits = text.replace(/[\s+()-]/g, '');
  return {
    uuid: UUID.test(text) ? text.toLowerCase() : null,
    digits: mayUseContact && /^\d{6,15}$/.test(digits) ? digits : null,
    text,
  };
}

/** One row of the accounts list. */
export interface AdminAccountRow {
  kind: AccountDetailKind;
  id: string;
  name: string;
  sign_in: SignInMethod;
  farmer_number: string | null;
  /** Declared on the account's profile; 'farmer' / 'buyer' also from its records. */
  actor_types: string[];
  organisations: string[];
  state_id: string | null;
  joined_at: string;
  first_sign_in_at: string | null;
  last_active_at: string | null;
  status: AccountStatus;
  /**
   * 2026-10-31: an ORGANISATION's verification only -- an organisational
   * profile's ('unverified' | 'verified'), or a person's business buyer
   * organisation's standing. Null for an individual, who is never verified.
   */
  verification: string | null;
  phone_verified: boolean;
  /** The public profile: draft, published, or none. */
  publication: string;
  advisory: AdvisoryStatus;
}

export interface AccountTimelineItem {
  at: string;
  /** 'access' -- a sign-in event; 'action' -- something the account did. */
  source: 'access' | 'action';
  /** An access event key or an audit action key. */
  event: string;
}

export interface StaffActionItem {
  at: string;
  action: string;
  actor_name: string | null;
  /** The staff member's written reason, when the action carries one. */
  reason: string | null;
}

/** GET /api/admin/accounts/:kind/:id -- one account, as authorised staff see it. */
export interface AdminAccountDetail {
  row: AdminAccountRow;
  records: {
    farmer_id: string | null;
    buyer_id: string | null;
    buyer_organization: { id: string; name: string; verification: string } | null;
  };
  profile: {
    display_name: string | null;
    about: string | null;
    profile_kind: string | null;
    public_id: string | null;
  } | null;
  contacts: {
    phone_masked: string | null;
    phone_verified: boolean;
    email_masked: string | null;
    /** Null when the sign-in service could not be asked. */
    email_confirmed: boolean | null;
    /** Whether the caller may reveal a contact (support.handle). */
    can_reveal: boolean;
  };
  standing: AccountStanding | null;
  /** Whether the caller may lift a disable (a Super Admin). */
  can_reenable: boolean;
  /** Whether the caller may suspend, disable or restore (content.moderate). */
  can_moderate: boolean;
  organisations: { id: string; name: string; role: string; status: string }[];
  timeline: AccountTimelineItem[];
  staff_actions: StaffActionItem[];
}
