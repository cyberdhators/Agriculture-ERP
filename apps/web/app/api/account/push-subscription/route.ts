import { BUYER_ROLE, FARMER_ROLE, pushSubscriptionSchema } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/** More than any one person's phones; the oldest beyond it stop getting alerts. */
const MOST_PHONES = 10;

/**
 * POST /api/account/push-subscription (2026-11-03). The signed-in account
 * turns alerts on for this phone. One phone is one row: when someone else
 * signs in on it and turns alerts on, the row becomes theirs, so a phone never
 * gets two people's alerts. The audit row carries no address or key.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: pushSubscriptionSchema,
    handler: async ({ auth, body }) => {
      const authUserId = auth.principal.authUserId;
      await audited(prisma, async (tx) => {
        const [row] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO public.push_subscription (auth_user_id, endpoint, p256dh, auth, language)
           VALUES ($1::uuid, $2, $3, $4, $5)
           ON CONFLICT (endpoint) DO UPDATE
             SET auth_user_id = EXCLUDED.auth_user_id, p256dh = EXCLUDED.p256dh,
                 auth = EXCLUDED.auth, language = EXCLUDED.language,
                 deleted_at = NULL, updated_at = now()
           RETURNING id`,
          authUserId,
          body.endpoint,
          body.keys.p256dh,
          body.keys.auth,
          body.language,
        );
        await tx.$executeRawUnsafe(
          `UPDATE public.push_subscription SET deleted_at = now(), updated_at = now()
            WHERE auth_user_id = $1::uuid AND deleted_at IS NULL AND id NOT IN (
              SELECT id FROM public.push_subscription
               WHERE auth_user_id = $1::uuid AND deleted_at IS NULL
               ORDER BY updated_at DESC LIMIT ${MOST_PHONES})`,
          authUserId,
        );
        await writeAudit(tx, {
          entityType: 'push_subscription',
          entityId: row!.id,
          actorType: auth.role === 'buyer' ? 'buyer' : 'farmer',
          actorId: auth.principal.id,
          action: 'push_subscription.created',
          after: { language: body.language },
        });
      });
      return ok({ on: true });
    },
  },
});
