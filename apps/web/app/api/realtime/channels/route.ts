import {
  BUYER_ROLE,
  FARMER_ROLE,
  accountChannel,
  organizationChannel,
  presenceChannel,
  type RealtimeChannels,
} from '@agri-erp/shared';

import { inboxOrganizations, membershipsOf, showsActivity } from '../../../../lib/api/presence';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';
import { realtimeSigningConfig } from '../../../../lib/realtime/config';

/**
 * GET /api/realtime/channels (2026-10-26) -- which live channels the
 * signed-in farmer or buyer account should subscribe to: its own account
 * channel, the shared inbox of every organisation where it holds inbox.read,
 * and its own presence channel while "show when I'm active" is on.
 *
 * This only SAYS what to subscribe to. Each subscription is authorized again,
 * one by one, by POST /api/realtime/auth, which applies the same rule
 * (shared/src/realtime.ts mayJoinChannel) -- this list grants nothing.
 *
 * `enabled: false` when the deployment has no Realtime app configured: the
 * screens then keep polling as they always did. No key or secret is ever in
 * the answer; the browser has the public key from NEXT_PUBLIC_ settings.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth }) => {
      const me = auth.principal.authUserId;
      if (!realtimeSigningConfig()) {
        return ok({ enabled: false, me, channels: [] } satisfies RealtimeChannels);
      }
      const [memberships, shows] = await Promise.all([
        membershipsOf(prisma, me),
        showsActivity(prisma, [me]),
      ]);
      const channels = [
        accountChannel(me),
        ...inboxOrganizations(memberships).map(organizationChannel),
        ...(shows.get(me) !== false ? [presenceChannel(me)] : []),
      ];
      return ok({ enabled: true, me, channels } satisfies RealtimeChannels, {
        'cache-control': 'no-store',
      });
    },
  },
});
