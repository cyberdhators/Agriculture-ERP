import { z } from 'zod';

/**
 * WHO YOU ARE, WHAT YOU DO (2026-10-19, CORWADO's 16 October specification).
 * An account's profile kind and activities: chosen in an optional setup step,
 * editable later, several activities at once. They personalise shortcuts and
 * never restrict what the account may do -- every account may buy, sell,
 * publish buying requests, offer services and seek advice.
 */

export const PROFILE_KINDS = ['individual', 'group', 'business', 'institution'] as const;

/** A group's kind. RPO is a reporting umbrella, not a separate kind (the spec). */
export const GROUP_KINDS = [
  'producer_group',
  'cooperative',
  'vsla',
  'sacco',
  'other_association',
] as const;

export const ACTIVITIES = [
  'farmer',
  'trader',
  'processor',
  'input_supplier',
  'transport',
  'other_services',
  'knowledge_provider',
  'financial_services',
  'buyer',
] as const;

export type ProfileKind = (typeof PROFILE_KINDS)[number];
export type GroupKind = (typeof GROUP_KINDS)[number];
export type Activity = (typeof ACTIVITIES)[number];

export const ACCOUNT_PROFILE_MESSAGES = {
  kindUnknown: 'Choose individual, group, business or institution.',
  groupKindRequired: 'Choose what kind of group it is.',
  groupKindOnlyForGroups: 'Only a group has a group kind.',
  activityUnknown: 'Choose activities from the list.',
  activitiesDuplicate: 'Each activity once.',
} as const;

export const accountProfileSchema = z
  .strictObject({
    profile_kind: z.enum(PROFILE_KINDS, { error: () => ACCOUNT_PROFILE_MESSAGES.kindUnknown }),
    group_kind: z
      .enum(GROUP_KINDS, { error: () => ACCOUNT_PROFILE_MESSAGES.groupKindRequired })
      .nullable()
      .optional(),
    activities: z
      .array(z.enum(ACTIVITIES, { error: () => ACCOUNT_PROFILE_MESSAGES.activityUnknown }))
      .refine((list) => new Set(list).size === list.length, {
        message: ACCOUNT_PROFILE_MESSAGES.activitiesDuplicate,
      }),
  })
  .superRefine((value, ctx) => {
    const hasGroupKind = value.group_kind !== null && value.group_kind !== undefined;
    if (value.profile_kind === 'group' && !hasGroupKind) {
      ctx.addIssue({
        code: 'custom',
        path: ['group_kind'],
        message: ACCOUNT_PROFILE_MESSAGES.groupKindRequired,
      });
    }
    if (value.profile_kind !== 'group' && hasGroupKind) {
      ctx.addIssue({
        code: 'custom',
        path: ['group_kind'],
        message: ACCOUNT_PROFILE_MESSAGES.groupKindOnlyForGroups,
      });
    }
  });

export type AccountProfile = z.infer<typeof accountProfileSchema>;

// ---------------------------------------------------------------------------
// DELETE MY ACCOUNT (2026-10-20). The owner: hide now, keep for audit.
// ---------------------------------------------------------------------------

// Each pinned in docs/api/CONVENTIONS.md §5.2.3
export const ACCOUNT_DELETION_MESSAGES = {
  passwordRequired: 'Enter your password to confirm.',
  confirmRequired: 'Tick the box to confirm you want to delete your account.',
} as const;

/** The account's own password, and an explicit yes. Nothing else. */
export const deleteAccountSchema = z.strictObject({
  password: z
    .string({ error: () => ACCOUNT_DELETION_MESSAGES.passwordRequired })
    .min(1, ACCOUNT_DELETION_MESSAGES.passwordRequired)
    .max(200, ACCOUNT_DELETION_MESSAGES.passwordRequired),
  confirm: z.literal(true, { error: () => ACCOUNT_DELETION_MESSAGES.confirmRequired }),
  /**
   * 2026-10-27 (team access): the person is the last administrator of one or
   * more organisations and chooses to close them with the account. Without
   * it, deletion is refused with the list (organization_last_admin_delete).
   */
  close_organizations: z
    .boolean({ error: () => ACCOUNT_DELETION_MESSAGES.confirmRequired })
    .optional(),
});
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
