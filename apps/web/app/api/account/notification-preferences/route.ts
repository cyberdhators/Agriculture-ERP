import {
  BUYER_ROLE,
  FARMER_ROLE,
  PREFERENCE_FIELDS,
  notificationPreferencesSchema,
  type NotificationPreferences,
} from '@agri-erp/shared';

import { preferencesOf } from '../../../../lib/api/announcements';
import { audited, writeAudit } from '../../../../lib/api/audit';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * GET / PUT /api/account/notification-preferences (2026-10-27). The
 * signed-in account's own switches, keyed by its sign-in -- one account,
 * buying and selling -- so the farmer side and the buyer side share one set.
 * Nobody else's preferences are readable or writable here.
 *
 * What can be switched off: announcements in the app, by SMS and by email,
 * and activity updates (messages, advice) in the app. ESSENTIAL AND SECURITY
 * MESSAGES HAVE NO SWITCH: account decisions, a suspension, sign-in codes and
 * announcements staff mark essential always go.
 *
 * The audit row names the switches that changed and their new values.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth }) => ok(await preferencesOf(auth.principal.authUserId)),
  },

  PUT: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: notificationPreferencesSchema,
    handler: async ({ auth, body: raw }) => {
      const body = raw as NotificationPreferences;
      const authUserId = auth.principal.authUserId;
      const saved = await audited(prisma, async (tx) => {
        const before = await preferencesOf(authUserId, tx);
        await tx.$executeRawUnsafe(
          `INSERT INTO public.notification_preference
             (auth_user_id, announcements_in_app, announcements_sms, announcements_email,
              updates_in_app, updated_at)
           VALUES ($1::uuid, $2, $3, $4, $5, now())
           ON CONFLICT (auth_user_id) DO UPDATE
             SET announcements_in_app = EXCLUDED.announcements_in_app,
                 announcements_sms = EXCLUDED.announcements_sms,
                 announcements_email = EXCLUDED.announcements_email,
                 updates_in_app = EXCLUDED.updates_in_app,
                 updated_at = now()`,
          authUserId,
          body.announcements_in_app,
          body.announcements_sms,
          body.announcements_email,
          body.updates_in_app,
        );
        const changed = PREFERENCE_FIELDS.filter((k) => before[k] !== body[k]);
        await writeAudit(tx, {
          entityType: 'notification_preference',
          entityId: authUserId,
          actorType: auth.role === 'buyer' ? 'buyer' : 'farmer',
          actorId: auth.principal.id,
          action: 'notification_preference.updated',
          before: Object.fromEntries(changed.map((k) => [k, before[k]])),
          after: Object.fromEntries(changed.map((k) => [k, body[k]])),
        });
        return preferencesOf(authUserId, tx);
      });
      return ok(saved);
    },
  },
});
