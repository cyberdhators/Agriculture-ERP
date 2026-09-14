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
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** `system` is for the reseed and any other script with no principal (C-4.3). */
export const AUDIT_ACTOR_TYPES = ['admin', 'supervisor', 'read_only', 'officer', 'system'] as const;

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
