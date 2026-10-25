import { z } from 'zod';

import { ORGANIZATION_MESSAGES } from './organization';
import {
  holdsPermission,
  type EffectivePermissions,
  type PermissionKey,
} from './staff-permissions';

/**
 * ONLY ORGANISATIONS ARE VERIFIED (2026-10-31). The owner: "remove
 * verification from accounts. only organization needs to be verified by admin
 * and superadmin not individual." docs/DECISIONS.md, "Only organisations are
 * verified (2026-10-31)".
 *
 * - An INDIVIDUAL account (a phone account, or an email account of the
 *   individual kind) is never verified: no status, no badge, no gate.
 * - An ORGANISATION is verified by staff holding `organization.verify` -- the
 *   Administrator and Super Admin presets. Two kinds of organisation exist:
 *   a buyer organisation of the business kind (buyer_organization, its
 *   existing review) and an organisational profile (organization, team
 *   access). Either way verification is a BADGE ONLY: an unverified
 *   organisation works normally (CORWADO's specification: "ordinary
 *   participation must not depend on CORWADO approval").
 * - The extension programme's field record of an officer-registered farmer
 *   (verification_event, farmer_verified_v) is not an account verification:
 *   it stays an internal record for programme reports, shown to officers and
 *   staff only.
 *
 * Everything here is pure; packages/shared/tests/organization-verification.test.ts.
 */

/** The permission a staff member needs to verify an organisation, or to remove the mark. */
export const ORGANIZATION_VERIFY_PERMISSION =
  'organization.verify' as const satisfies PermissionKey;

/** An organisational profile's verification. 'unverified' is where every one starts. */
export const ORG_VERIFICATION_STATUSES = ['unverified', 'verified'] as const;
export type OrgVerificationStatus = (typeof ORG_VERIFICATION_STATUSES)[number];

/** May this staff member verify organisations (platform-wide)? */
export const mayVerifyOrganizations = (permissions: EffectivePermissions): boolean =>
  holdsPermission(permissions, ORGANIZATION_VERIFY_PERMISSION);

/**
 * The staff decision on an organisational profile. Removing the mark needs a
 * reason (it is kept on the profile and in the audit); verifying may carry an
 * optional note of what was checked.
 */
export const organizationVerificationSchema = z
  .strictObject({
    verified: z.boolean({ error: () => ORGANIZATION_MESSAGES.confirmRequired }),
    note: z
      .string({ error: () => ORGANIZATION_MESSAGES.reasonLength })
      .trim()
      .min(3, ORGANIZATION_MESSAGES.reasonLength)
      .max(300, ORGANIZATION_MESSAGES.reasonLength)
      .optional(),
  })
  .refine((v) => v.verified || v.note !== undefined, {
    message: ORGANIZATION_MESSAGES.reasonLength,
    path: ['note'],
  });
export type OrganizationVerificationInput = z.infer<typeof organizationVerificationSchema>;

export type OrgVerificationRefusal = 'organization_closed' | 'transition_not_allowed';

/**
 * Whether the decision may be made on this organisation now. A closed
 * organisation is not verified (or un-verified: its record is final), and a
 * decision that changes nothing is refused rather than written twice.
 */
export function orgVerificationDecision(input: {
  current: OrgVerificationStatus;
  closed: boolean;
  verified: boolean;
}):
  | { allowed: true; to: OrgVerificationStatus }
  | { allowed: false; reason: OrgVerificationRefusal } {
  if (input.closed) return { allowed: false, reason: 'organization_closed' };
  const to: OrgVerificationStatus = input.verified ? 'verified' : 'unverified';
  if (to === input.current) return { allowed: false, reason: 'transition_not_allowed' };
  return { allowed: true, to };
}

/** The audit action each decision writes. */
export const orgVerificationAuditAction = (
  to: OrgVerificationStatus,
): 'organization.verified' | 'organization.verification_removed' =>
  to === 'verified' ? 'organization.verified' : 'organization.verification_removed';

/**
 * WHO A VERIFICATION BADGE MAY BELONG TO. A buyer organisation counts only
 * when it is of the business kind and verified; an individual's account is
 * never a verified anything, whatever an old row says.
 */
export const buyerOrganizationVerified = (
  accountType: string | null | undefined,
  status: string | null | undefined,
): boolean => accountType !== 'individual' && status === 'verified';

/** The one badge word, wherever an organisation's verification is shown. */
export const VERIFIED_ORGANISATION_LABEL = 'Verified organisation';
