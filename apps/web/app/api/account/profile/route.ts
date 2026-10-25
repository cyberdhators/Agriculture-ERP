import { BUYER_ROLE, FARMER_ROLE, accountProfileSchema } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { settingValue } from '../../../../lib/api/settings';
import { prisma } from '../../../../lib/db';

/**
 * GET / PUT /api/account/profile — who this account is and what it does
 * (2026-10-19, CORWADO's specification): individual, group, business or
 * institution, and any of the activities. Optional, editable, and never a
 * restriction: every account may buy, sell, post buying requests, offer
 * services and seek advice whatever it chooses here.
 *
 * About the signed-in account itself, keyed by the sign-in -- one account,
 * buying and selling -- so a farmer and a buyer reach the same record. Nobody
 * else's profile is readable or writable here.
 */
interface Row {
  profile_kind: string;
  group_kind: string | null;
  activities: string[];
  updated_at: Date;
}

const present = (row: Row | undefined) =>
  row
    ? {
        profile_kind: row.profile_kind,
        group_kind: row.group_kind,
        activities: row.activities,
        set: true,
      }
    : { profile_kind: 'individual', group_kind: null, activities: [], set: false };

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth }) => {
      const [row] = await prisma.$queryRawUnsafe<Row[]>(
        `SELECT profile_kind, group_kind, activities, updated_at
           FROM public.account_profile WHERE auth_user_id = $1::uuid`,
        auth.principal.authUserId,
      );
      return ok(present(row));
    },
  },
  PUT: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: accountProfileSchema,
    handler: async ({ auth, body }) => {
      const authUserId = auth.principal.authUserId;
      const privacy = await settingValue('profile_privacy');
      const row = await audited(prisma, async (tx) => {
        const [before] = await tx.$queryRawUnsafe<Row[]>(
          `SELECT profile_kind, group_kind, activities, updated_at
             FROM public.account_profile WHERE auth_user_id = $1::uuid FOR UPDATE`,
          authUserId,
        );
        const [after] = await tx.$queryRawUnsafe<Row[]>(
          // 2026-10-27 (settings phase 2): a NEW profile row takes Profile
          // privacy's defaults; an existing row's choices are never touched
          // (the conflict branch does not set them).
          `INSERT INTO public.account_profile
             (auth_user_id, profile_kind, group_kind, activities, show_phone, allow_messages)
           VALUES ($1::uuid, $2, $3, $4::text[], $5, $6)
           ON CONFLICT (auth_user_id) DO UPDATE
             SET profile_kind = EXCLUDED.profile_kind, group_kind = EXCLUDED.group_kind,
                 activities = EXCLUDED.activities, updated_at = now()
           RETURNING profile_kind, group_kind, activities, updated_at`,
          authUserId,
          body.profile_kind,
          body.group_kind ?? null,
          body.activities,
          privacy.show_phone_default,
          privacy.allow_messages_default,
        );
        await writeAudit(tx, {
          entityType: 'account_profile',
          entityId: authUserId,
          actorType: auth.role === 'buyer' ? 'buyer' : 'farmer',
          actorId: auth.principal.id,
          action: 'account.profile_updated',
          before: before
            ? {
                profile_kind: before.profile_kind,
                group_kind: before.group_kind,
                activities: before.activities,
              }
            : null,
          after: {
            profile_kind: after!.profile_kind,
            group_kind: after!.group_kind,
            activities: after!.activities,
          },
        });
        return after;
      });
      return ok(present(row));
    },
  },
});
