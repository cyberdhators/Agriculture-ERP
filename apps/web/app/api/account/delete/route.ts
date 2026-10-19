import { BUYER_ROLE, FARMER_ROLE, deleteAccountSchema } from '@agri-erp/shared';

import { recordReauthFailed } from '../../../../lib/api/access-log';
import { audited, writeAudit } from '../../../../lib/api/audit';
import { forbidden } from '../../../../lib/api/errors';
import { reauthenticate } from '../../../../lib/api/reauth';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { requireReauth } from '../../../../lib/api/staff-access';
import { prisma } from '../../../../lib/db';
import { disableAuthAccount } from '../../../../lib/supabase/admin';

/**
 * POST /api/account/delete -- "Delete my account" (2026-10-20, CORWADO's 16
 * October specification). The owner: hide now, keep for audit.
 *
 * The account's own password first (lib/api/reauth.ts, the Super Admin check:
 * a throwaway sign-in, the password never kept), then, in ONE transaction:
 *
 *   - every live post withdrawn: produce listings, buying requests, services;
 *   - every conversation closed, and the account's name in it replaced by
 *     "Former member" -- what was said stays for the other person;
 *   - the farmer and the buyer record soft-deleted (deleted_at; never removed),
 *     so they leave every list, count, export and the market;
 *   - one audit row per record, carrying what was withdrawn and closed.
 *
 * Then the sign-in is disabled (banned), which also ends sessions on other
 * phones. If Supabase does not answer, the records are already deleted and
 * requireRole refuses the account everywhere (it reads the _active views), so
 * the ban is a second lock, not the only one; the answer says which happened.
 *
 * Coming back: the phone and sign-in stay attached to the deleted record, so
 * a new account with the same phone is refused; restoring is CORWADO's, by
 * hand, for now. Staff accounts cannot use this route.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: deleteAccountSchema,
    handler: async ({ auth, body, request }) => {
      if (auth.principal.kind !== 'farmer' && auth.principal.kind !== 'buyer') throw forbidden();
      const me = auth.principal.authUserId;

      await requireReauth(await reauthenticate(me, body.password), () =>
        recordReauthFailed(auth, request),
      );

      await audited(prisma, async (tx) => {
        const [farmer] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM public.farmer
            WHERE auth_user_id = $1::uuid AND deleted_at IS NULL FOR UPDATE`,
          me,
        );
        const [buyer] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM public.buyer
            WHERE auth_user_id = $1::uuid AND deleted_at IS NULL FOR UPDATE`,
          me,
        );
        const farmerId = farmer?.id ?? null;
        const buyerId = buyer?.id ?? null;

        const count = async (sql: string, ...args: unknown[]) =>
          (await tx.$queryRawUnsafe<{ id: string }[]>(sql, ...args)).length;

        const listings = farmerId
          ? await count(
              `UPDATE public.produce_listing SET status = 'withdrawn', updated_at = now()
                WHERE farmer_id = $1::uuid AND deleted_at IS NULL
                  AND status IN ('draft', 'listed', 'paused')
                RETURNING id`,
              farmerId,
            )
          : 0;
        const requests = await count(
          `UPDATE public.buying_request SET status = 'withdrawn', updated_at = now()
            WHERE (farmer_id = $1::uuid OR buyer_id = $2::uuid) AND deleted_at IS NULL
              AND status IN ('draft', 'active', 'paused')
            RETURNING id`,
          farmerId,
          buyerId,
        );
        const services = farmerId
          ? await count(
              `UPDATE public.service_listing SET status = 'withdrawn', updated_at = now()
                WHERE farmer_id = $1::uuid AND deleted_at IS NULL
                  AND status IN ('draft', 'active', 'paused')
                RETURNING id`,
              farmerId,
            )
          : 0;
        const conversations = await count(
          `UPDATE public.conversation
              SET owner_name = CASE WHEN owner_auth_user_id = $1::uuid
                                    THEN 'Former member' ELSE owner_name END,
                  starter_name = CASE WHEN starter_auth_user_id = $1::uuid
                                      THEN 'Former member' ELSE starter_name END,
                  blocked_at = COALESCE(blocked_at, now()),
                  blocked_by = COALESCE(blocked_by, $1::uuid)
            WHERE $1::uuid IN (owner_auth_user_id, starter_auth_user_id)
            RETURNING id`,
          me,
        );
        const after = {
          self_deleted: true,
          listings_withdrawn: listings,
          buying_requests_withdrawn: requests,
          services_withdrawn: services,
          conversations_closed: conversations,
        };

        if (farmerId) {
          await tx.$executeRawUnsafe(
            `UPDATE public.farmer SET deleted_at = now() WHERE id = $1::uuid`,
            farmerId,
          );
          await writeAudit(tx, {
            entityType: 'farmer',
            entityId: farmerId,
            actorType: 'farmer',
            actorId: farmerId,
            action: 'farmer.soft_deleted',
            before: { deleted_at: null },
            after,
          });
        }
        if (buyerId) {
          await tx.$executeRawUnsafe(
            `UPDATE public.buyer SET deleted_at = now() WHERE id = $1::uuid`,
            buyerId,
          );
          await writeAudit(tx, {
            entityType: 'buyer',
            entityId: buyerId,
            actorType: 'buyer',
            actorId: buyerId,
            action: 'buyer.soft_deleted',
            before: { deleted_at: null },
            after,
          });
        }
      });

      let signInDisabled = true;
      try {
        await disableAuthAccount(me);
      } catch {
        signInDisabled = false;
      }
      return ok({ deleted: true, sign_in_disabled: signInDisabled });
    },
  },
});
