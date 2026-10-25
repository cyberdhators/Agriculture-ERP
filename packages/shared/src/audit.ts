import { z } from 'zod';

import { OFFICER_AUTH_DOMAIN } from './identity';
import { scrubString } from './scrub';

/**
 * The audit log. Unit B4, criteria C-4.1 to C-4.9.
 *
 * ACTIONS ARE KEYS, NEVER SENTENCES (C-4.7). This list is the single source:
 * the CHECK constraint in migration 9 is generated from it, so the database
 * refuses any key not here, and adding one means adding it in both places in
 * the same change -- which a reviewer sees.
 */
export const AUDIT_ACTIONS = [
  'user.created',
  'user.updated',
  'user.password_set',
  'user.soft_deleted',
  'officer.created',
  'officer.updated',
  'officer.status_changed',
  'officer.password_set',
  'officer.soft_deleted',
  'auth.disabled',
  'auth.disable_failed',
  'auth.account_orphaned',
  'location.created',
  'location.renamed',
  'location.soft_deleted',
  'farmer.created',
  'farmer.updated',
  'farmer.soft_deleted',
  'consent.recorded',
  'farmer.verified',
  'farmer.rejected',
  'farmer.merged',
  'farmer.resubmitted',
  'farmer.reassigned',
  'farm.created',
  'farm.boundary_added',
  'farm.boundary_superseded',
  'farm.crops_declared',
  'farm.soft_deleted',
  'farm.repointed',
  'visit.recorded',
  'visit.corrected',
  'visit.soft_deleted',
  'visit.attachment_declared',
  'visit.attachment_arrived',
  'visit.attachment_failed',
  // The one read that is audited: issuing an expiring link to a farmer's
  // photograph produces an artefact that outlives the request (B8, owner).
  'visit.attachment_link_issued',
  'visit.repointed',
  'report.exported',
  // C-11.4: the one event that removes audit entries leaves a note saying so.
  'system.restored',
  'directory_entry.created',
  'directory_entry.updated',
  'directory_entry.soft_deleted',
  'learning_resource.created',
  'learning_resource.updated',
  'learning_resource.published',
  'learning_resource.soft_deleted',
  // 2026-10-22: Advice & Learning's draft -> review -> publish moves. Publish
  // reuses the key above. NO CHECK MIGRATION ON THIS BRANCH: the combined one
  // is written when the three branches that add keys land.
  'learning_resource.submitted',
  'learning_resource.returned',
  'learning_resource.unpublished',
  // C-16: a weather location is a managed record. A forecast fetch is NOT audited
  // (C-16.11) -- it is a scheduled read of a third party, not an action on a record.
  'weather_location.created',
  'weather_location.updated',
  'weather_location.soft_deleted',
  // Marketplace moderation and administrator communications, added 2026-09-17.
  // The CHECK in migration 20260917120000 is generated from this list; the two
  // change together in one commit or the database refuses the key.
  'product_report.created',
  'product_report.status_changed',
  'product_report.listing_removed',
  // The SEND is audited; the message body never is (C-4.6, C-4.7).
  'communication.email_sent',
  'communication.send_failed',
  'listing.created',
  'listing.updated',
  'listing.status_changed',
  'listing.soft_deleted',
  'contact_request.created',
  'contact_request.handled',
  'market_price.created',
  'market_price.soft_deleted',
  'notification.created',
  'notification.read',
  // B13 (2026-10-06): buyer accounts and procurement. The CHECK in migration
  // 20261006090000 is generated from this list. A verification decision is
  // its own key so the review trail can be read without decoding `after`.
  'buyer.registered',
  'buyer.updated',
  'buyer_organization.updated',
  'buyer_organization.verification_changed',
  'purchase_request.created',
  'purchase_request.updated',
  'purchase_request.submitted',
  'purchase_request.cancelled',
  'purchase_request.decided',
  'purchase_order.created',
  'purchase_order.status_changed',
  'purchase_order.cancelled',
  // 2026-10-10: an administrator's SMS to farmers or officers through Bird.
  // The CHECK in migration 20261010120000 is generated from this list. The
  // send route reads that CHECK before sending, so the code is safe to deploy
  // ahead of the migration: it refuses SMS until the key is accepted.
  'communication.sms_sent',
  // ACCOUNTS LANE (2026-10-19): an account's profile kind and activities.
  'account.profile_updated',
  // STAFF PERMISSIONS LANE (2026-10-19): permission presets, Super Admin
  // delegation and session revocation. The CHECK in migration 20261019110100
  // is generated from this list. Revoking sessions is an HTTP call to Supabase
  // with no transaction, so it records its OUTCOME, success or failure, as
  // auth.disabled / auth.disable_failed do.
  'staff.permission_granted',
  'staff.permission_revoked',
  'superadmin.granted',
  'superadmin.revoked',
  'staff.sessions_revoked',
  'staff.sessions_revoke_failed',
  // 2026-10-20: in-app messaging. Ids only in the audit row, never message text.
  'conversation.started',
  'message.sent',
  'conversation.blocked',
  // 2026-10-20: an account deletes itself; the buyer record is soft-deleted.
  'buyer.soft_deleted',
  // 2026-10-21: staff suspend and restore a farmer or buyer account.
  'account.suspended',
  'account.restored',
  // 2026-10-29: a suspension with a duration ended by itself (the daily job, actor system).
  'account.suspension_expired',
  // 2026-10-21: "Contact CORWADO". Ids and the topic only, never message text.
  'support_message.created',
  'support_message.done',
  // 2026-10-22: independent advice. Ids and statuses only in the audit row,
  // never a question, a message or a feedback comment. The database CHECK for
  // these comes in one combined migration (see 20261022090000_advice_requests).
  'advice_provider.saved',
  'advice_case.created',
  'advice_case.status_changed',
  'advice_case.closed',
  'advice_case.feedback',
  // 2026-10-22: an analytics workbook downloaded. The filters, cut-off, row
  // counts and queries are in `after`; the figures themselves are not. NOT YET
  // IN THE DATABASE CHECK: one combined CHECK migration adds it (the owner).
  'analytics.exported',
  // 2026-10-23: public profiles v2. The NAMES of changed fields only, never
  // the about text, a tag, a name or a storage path; statuses and ids. NOT YET
  // IN THE DATABASE CHECK: one combined CHECK migration adds them (the owner).
  'profile.saved',
  'profile.published',
  'profile.unpublished',
  'profile.photo_changed',
  'profile.photo_removed',
  'profile.photo_removed_by_staff',
  // 2026-10-24: the optional approved-adviser pathway (independent advice,
  // part 2). The applicant's actions carry ids and statuses only, never the
  // application's text; a staff decision carries its recorded reason, as an
  // account suspension does. NOT YET IN THE DATABASE CHECK: one combined CHECK
  // migration adds them (the owner).
  'adviser_application.submitted',
  'adviser_application.replied',
  'adviser_application.withdrawn',
  'adviser_application.clarification_requested',
  'adviser_application.approved',
  'adviser_application.declined',
  'adviser_approval.revoked',
  // 2026-10-25: independent advice, part 3 -- photos on a case and referral
  // with consent. Ids, statuses, a content type and a size only; never a
  // storage path, a question or a provider's words. NOT YET IN THE DATABASE
  // CHECK: one combined CHECK migration adds them (the owner).
  'advice_attachment.added',
  'advice_attachment.removed',
  'advice_referral.proposed',
  'advice_referral.accepted',
  'advice_referral.declined',
  'advice_referral.withdrawn',
  // 2026-10-25: settings, phase 1. A setting save carries its key, the old
  // and new version numbers and the NAMES of the changed fields (and, for the
  // banner, on or off; for reason codes, the codes added and archived) --
  // never a contact detail or the banner text. A notice row carries its kind,
  // language, version and status, never its body.
  'setting.changed',
  'notice.drafted',
  'notice.draft_edited',
  'notice.draft_discarded',
  'notice.published',
  'notice.retired',
  // TEAM ACCESS (2026-10-27): organisational profiles, members, invitations.
  'organization.created',
  'organization.updated',
  'organization.published',
  'organization.unpublished',
  'organization.closed',
  'organization.recovered',
  'organization_member.joined',
  'organization_member.updated',
  'organization_member.revoked',
  'organization_member.left',
  'organization_invitation.created',
  'organization_invitation.accepted',
  'organization_invitation.declined',
  'organization_invitation.cancelled',
  'organization_transfer.offered',
  'organization_transfer.accepted',
  'organization_transfer.declined',
  'organization_transfer.cancelled',
  // 2026-10-27: self-service password recovery by SMS code (how, and whether
  // every other session was ended -- never the password or the number), and a
  // moderator's correction request on a marketplace post and its being
  // addressed by the owner's edit (the code, the note, the NAMES of changed
  // fields). NOT YET IN THE DATABASE CHECK: the integrator's combined CHECK
  // migration adds them.
  'account.password_recovered',
  'listing.correction_requested',
  'listing.correction_addressed',
  // 2026-10-28 (admin console lane): a permanent DISABLE of an account
  // (distinct from suspend; lifted only by a Super Admin, with a reason), a
  // staff member revealing an account's private contact (which field, never
  // the value), a staff removal of a marketplace post from the console (not
  // through a report), and support CASES: a change of status, type, priority,
  // assignee, evidence or resolution, and a staff reply to the person. NOT
  // YET IN THE DATABASE CHECK: the integrator's combined CHECK migration adds them.
  'account.disabled',
  'account.reenabled',
  'account.contact_revealed',
  'listing.removed',
  'support_case.updated',
  'support_case.replied',
  // 2026-10-28 (user journeys): one account blocks or unblocks another, person
  // level (ids only, never a name); the daily job's reminder that a post ends
  // soon (kind, id, end date). NOT YET IN THE DATABASE CHECK: the integrator's
  // combined CHECK migration adds them.
  'account.blocked',
  'account.unblocked',
  'post.expiry_reminder_sent',
  // USER JOURNEYS (2026-10-28): an email account's acknowledgement of the
  // terms and privacy notice at sign-up (version and language only). NOT YET
  // IN THE DATABASE CHECK: the integrator's combined CHECK migration adds it.
  'acknowledgement.recorded',
  // 2026-10-27: official announcements, message templates and notification
  // preferences. A template row carries its channel, status and the NAMES of
  // changed fields; an announcement row its scope, channels, category and
  // counts -- never a message's text, a recipient or a contact. NOT YET IN
  // THE DATABASE CHECK: one combined CHECK migration adds them (the owner).
  'message_template.created',
  'message_template.updated',
  'message_template.status_changed',
  'announcement.drafted',
  'announcement.draft_edited',
  'announcement.draft_discarded',
  'announcement.queued',
  'announcement.batch_sent',
  'announcement.retry_queued',
  'announcement.completed',
  'notification_preference.updated',
  // 2026-10-28 (lane-security): staff invitations (the address is never in a
  // row), two-step sign-in enrolment and reset, the advisory suspension and
  // restoration of an approval, official advisory notes, and an organisation's
  // shared advice inbox (assign, accept, release). NOT YET IN THE DATABASE
  // CHECK: the integrator's combined CHECK migration adds them.
  'staff.invited',
  'staff.invitation_revoked',
  'staff.invitation_accepted',
  'staff.mfa_enrolled',
  'staff.mfa_reset',
  'adviser_approval.suspended',
  'adviser_approval.restored',
  'advisory_note.submitted',
  'advisory_note.withdrawn',
  'advisory_note.returned',
  'advisory_note.published',
  'advisory_note.unpublished',
  'advice_case.assigned',
  'advice_case.accepted',
  'advice_case.released',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * `system` is for the reseed and any other script with no principal (C-4.3).
 * `buyer` (B13) is an outside organisation's purchaser acting on their own
 * records; the database type gained the value in migration 20261006090000.
 */
export const AUDIT_ACTOR_TYPES = [
  'admin',
  'supervisor',
  'read_only',
  'officer',
  'system',
  'buyer',
  // B14: a farmer acting on their own record, listings and buyer requests.
  'farmer',
] as const;

export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

/**
 * Keys that never enter before/after, whatever a caller passes (C-4.6, C-4.7).
 *
 * THIS IS NOT THE SENTRY SCRUBBER'S LIST, ON PURPOSE. That list redacts every
 * key called `name`, which is right for an envelope leaving for a third party
 * and wrong here: the audit log is our own admin-only table, and "who renamed
 * this payam, from what to what" is precisely what it exists to record. B4's
 * first version reused the scrubber's list and every rename came back empty.
 *
 * What is excluded: credentials and authentication links by key; a farmer's
 * identifiers by key (national id, phone, email); and phone-shaped strings by
 * VALUE wherever they appear, using the same one definition of a South Sudan
 * number as everything else.
 */
const NEVER_RECORDED = new Set([
  'password',
  'password_hash',
  'encrypted_password',
  'token',
  'access_token',
  'refresh_token',
  'authorization',
  'cookie',
  'auth_user_id',
  'national_id',
  // C-4.7: a farmer's name never enters the audit log. Staff `name` stays, as
  // B4 decided; a farmer is not staff and has two name fields of their own.
  'given_name',
  'family_name',
  // C-6.3: the rejection note is prose about a named person. Never in the log.
  'note',
  // C-7.10: a boundary is a location of a named person. Never in the log.
  'boundary',
  'centroid',
  'coordinates',
  'geometry',
  // C-8.13: observation and advice are the substance of a visit and prose about
  // a named person's field. Never in the log. The standing point likewise (C-8.4).
  'observation',
  'advice',
  'position',
  'phone',
  'alt_phone',
  'email',
  // B13. A buyer's credentials never enter the log, and neither do the
  // registration and tax numbers of their business (C-14B.21).
  'confirm_password',
  'registration_number',
  'tax_id',
]);

const normaliseKey = (key: string): string => key.toLowerCase().replace(/[_\-\s]/g, '');
const NEVER = new Set([...NEVER_RECORDED].map(normaliseKey));

const looksLikeDerivedIdentifier = (value: unknown): boolean =>
  typeof value === 'string' && value.toLowerCase().endsWith('@' + OFFICER_AUTH_DOMAIN);

/**
 * Reduces a before/after payload to what may be recorded.
 *
 * - Only the keys present are kept: callers pass CHANGED FIELDS, never rows.
 * - Credentials, the auth link and a farmer's identifiers are dropped by key.
 * - The derived officer identifier is dropped by VALUE wherever it appears,
 *   because it is an authentication identifier (C-4.6) and no key name is a
 *   reliable guard against it arriving under another one.
 * - Any phone-shaped string inside a value is redacted (C-4.7).
 */
export function auditSafe(
  payload: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!payload) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (NEVER.has(normaliseKey(key))) continue;
    if (looksLikeDerivedIdentifier(value)) continue;
    out[key] = typeof value === 'string' ? scrubString(value) : value;
  }
  return Object.keys(out).length === 0 ? null : out;
}

/** GET /api/audit filters (C-4.9). Every one optional; all validated before any query. */
export const auditFilterSchema = z.strictObject({
  entity_type: z.string().trim().min(1).max(64).optional(),
  entity_id: z.string().trim().min(1).max(128).optional(),
  actor_id: z.string().uuid().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});

export type AuditFilter = z.infer<typeof auditFilterSchema>;
