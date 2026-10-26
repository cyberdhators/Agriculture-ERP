import {
  BUYER_ROLE,
  FARMER_ROLE,
  mayJoinChannel,
  parseChannel,
  realtimeAuthSchema,
  type RealtimeAuthInput,
} from '@agri-erp/shared';

import { ApiFailure, forbidden } from '../../../../lib/api/errors';
import { membershipsOf, showsActivity } from '../../../../lib/api/presence';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';
import { signChannel } from '../../../../lib/realtime/publish';

/**
 * POST /api/realtime/auth (2026-10-26) -- Bird Realtime's channel
 * authorization endpoint. The browser client sends `{ connection_id,
 * channel_name }` for each private or presence subscription; this route
 * decides from the SESSION (never from the body) whether the caller may
 * join, and signs it with the app secret: HMAC-SHA256 over
 * `<connection_id>:<channel_name>[:<member_data>]`, prefixed with the app
 * key, by the server SDK's own `authorizeChannel` helper.
 *
 * The rule (shared/src/realtime.ts mayJoinChannel): one's own account
 * channel; an organisation's shared inbox with inbox.read; one's own presence
 * channel only while "show when I'm active" is on. Anything else is 403,
 * which is what Bird's client expects for a refused subscription.
 *
 * The answer is `{ data: { auth[, member_data] } }` (the project's envelope);
 * the screen's authorizer unwraps it for the SDK. The secret never leaves.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: realtimeAuthSchema,
    handler: async ({ auth, body: raw }) => {
      const body = raw as RealtimeAuthInput;
      const me = auth.principal.authUserId;
      const channel = parseChannel(body.channel_name);
      if (!channel) throw forbidden();
      const [memberships, shows] = await Promise.all([
        channel.kind === 'organization' ? membershipsOf(prisma, me) : Promise.resolve(new Map()),
        channel.kind === 'presence' ? showsActivity(prisma, [me]) : Promise.resolve(new Map()),
      ]);
      const allowed = mayJoinChannel(body.channel_name, {
        authUserId: me,
        memberships,
        showActivity: shows.get(me) !== false,
      });
      if (!allowed) throw forbidden();
      // A presence member is named by the sign-in only: no name, no profile.
      const memberData =
        channel.kind === 'presence' ? JSON.stringify({ member_id: me }) : undefined;
      const signed = await signChannel({
        connectionId: body.connection_id,
        channelName: body.channel_name,
        ...(memberData !== undefined ? { memberData } : {}),
      });
      if (!signed) {
        throw new ApiFailure(503, 'realtime_not_configured', 'Live updates are not available.');
      }
      return ok(signed, { 'cache-control': 'no-store' });
    },
  },
});
