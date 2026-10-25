import {
  BUYER_ROLE,
  FARMER_ROLE,
  accountProfileSchema,
  takesEnterpriseSize,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import { defineRoutes, ok } from '../../../../lib/api/route';
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
 *
 * 2026-10-27: ENTERPRISE SIZE (micro, small, medium, large; null = not
 * stated), for a group, business or institution only -- "SME is a size
 * classification, not an alternative to processor, supplier or trader". It is
 * separate from the activities. Shown on the public profile only when
 * `show_enterprise_size` is on. Left out of a save, both keep what was saved;
 * an individual's size is cleared.
 */
interface Row {
  profile_kind: string;
  group_kind: string | null;
  activities: string[];
  enterprise_size: string | null;
  show_enterprise_size: boolean;
  updated_at: Date;
}

const COLUMNS =
  'profile_kind, group_kind, activities, enterprise_size, show_enterprise_size, updated_at';

const present = (row: Row | undefined) =>
  row
    ? {
        profile_kind: row.profile_kind,
        group_kind: row.group_kind,
        activities: row.activities,
        enterprise_size: row.enterprise_size,
        show_enterprise_size: row.show_enterprise_size,
        set: true,
      }
    : {
        profile_kind: 'individual',
        group_kind: null,
        activities: [],
        enterprise_size: null,
        show_enterprise_size: false,
        set: false,
      };

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth }) => {
      const [row] = await prisma.$queryRawUnsafe<Row[]>(
        `SELECT ${COLUMNS} FROM public.account_profile WHERE auth_user_id = $1::uuid`,
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
      const row = await audited(prisma, async (tx) => {
        const [before] = await tx.$queryRawUnsafe<Row[]>(
          `SELECT ${COLUMNS} FROM public.account_profile WHERE auth_user_id = $1::uuid FOR UPDATE`,
          authUserId,
        );
        const sized = takesEnterpriseSize(body.profile_kind);
        const size = sized
          ? body.enterprise_size !== undefined
            ? body.enterprise_size
            : (before?.enterprise_size ?? null)
          : null;
        const showSize = sized
          ? (body.show_enterprise_size ?? before?.show_enterprise_size ?? false)
          : false;
        const [after] = await tx.$queryRawUnsafe<Row[]>(
          `INSERT INTO public.account_profile
             (auth_user_id, profile_kind, group_kind, activities, enterprise_size, show_enterprise_size)
           VALUES ($1::uuid, $2, $3, $4::text[], $5, $6)
           ON CONFLICT (auth_user_id) DO UPDATE
             SET profile_kind = EXCLUDED.profile_kind, group_kind = EXCLUDED.group_kind,
                 activities = EXCLUDED.activities, enterprise_size = EXCLUDED.enterprise_size,
                 show_enterprise_size = EXCLUDED.show_enterprise_size, updated_at = now()
           RETURNING ${COLUMNS}`,
          authUserId,
          body.profile_kind,
          body.group_kind ?? null,
          body.activities,
          size,
          showSize,
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
                enterprise_size: before.enterprise_size,
                show_enterprise_size: before.show_enterprise_size,
              }
            : null,
          after: {
            profile_kind: after!.profile_kind,
            group_kind: after!.group_kind,
            activities: after!.activities,
            enterprise_size: after!.enterprise_size,
            show_enterprise_size: after!.show_enterprise_size,
          },
        });
        return after;
      });
      return ok(present(row));
    },
  },
});
