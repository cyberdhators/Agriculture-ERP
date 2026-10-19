import { createHash } from 'node:crypto';

import {
  BUYER_ROLE,
  FARMER_ROLE,
  SUPPORT_MESSAGES_PER_DAY,
  supportMessageSchema,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../lib/api/audit';
import { ApiFailure, unprocessable } from '../../../lib/api/errors';
import { requireRole, type Authenticated } from '../../../lib/api/require-role';
import { created, defineRoutes } from '../../../lib/api/route';
import { prisma } from '../../../lib/db';

/**
 * POST /api/support -- "Contact CORWADO" from the help page (2026-10-21).
 * docs/DECISIONS.md, "Contact CORWADO". A message for the programme team; no
 * ticket, no reply thread, no status the sender can poll.
 *
 * PUBLIC, because a visitor who cannot sign in is exactly who needs help. A
 * signed-in farmer or buyer is still recognised: the session is read through
 * requireRole (the only place a session is read), and a caller with no
 * session, or a session that is neither farmer nor buyer, is a visitor. A
 * visitor must leave a phone or an email, or nobody can answer them. A
 * signed-in sender who leaves no phone is answered on the phone of their
 * own record.
 *
 * THE DAILY CAP, AND WHAT IT IS NOT. At most five messages a day per sender,
 * counted in the database: per sign-in for a farmer or buyer, and per
 * `source_digest` for a visitor. The digest is a ONE-WAY hash of
 * `x-forwarded-for`, which is trivially spoofed, so for visitors the cap is a
 * courtesy against an accidental flood, not a security control -- the same
 * exposure as the product-report route, written in its header. Two sends at
 * the same instant can both pass the count; a sixth message is the worst case.
 *
 * Message text, name, phone and email never enter the audit row: ids, the
 * sender kind and the topic only (C-4.7).
 */

/** The signed-in farmer or buyer, or null for a visitor. A 503 is passed on. */
async function senderOf(request: Request): Promise<Authenticated | null> {
  try {
    return await requireRole(request, [FARMER_ROLE, BUYER_ROLE]);
  } catch (failure) {
    if (failure instanceof ApiFailure && (failure.status === 401 || failure.status === 403)) {
      return null;
    }
    throw failure;
  }
}

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: 'public',
    bodySchema: supportMessageSchema,
    handler: async ({ body, request }) => {
      const sender = await senderOf(request);
      if (!sender && !body.phone && !body.email) throw unprocessable('support_contact_required');

      const source = request.headers.get('x-forwarded-for') ?? 'unknown';
      const digest = createHash('sha256').update(`support:${source}`).digest('hex');

      const [count] = await prisma.$queryRawUnsafe<{ n: number }[]>(
        sender
          ? `SELECT count(*)::int AS n FROM public.support_message
              WHERE from_auth_user_id = $1::uuid AND created_at >= date_trunc('day', now())`
          : `SELECT count(*)::int AS n FROM public.support_message
              WHERE from_auth_user_id IS NULL AND source_digest = $1
                AND created_at >= date_trunc('day', now())`,
        sender ? sender.principal.authUserId : digest,
      );
      if ((count?.n ?? 0) >= SUPPORT_MESSAGES_PER_DAY) throw unprocessable('support_limit_reached');

      // The sender's own phone when they gave none: the record they signed in as.
      let phone = body.phone ?? null;
      if (sender && !phone) {
        const table = sender.principal.kind === 'farmer' ? 'farmer_active' : 'buyer_active';
        const [own] = await prisma.$queryRawUnsafe<{ phone: string | null }[]>(
          `SELECT phone FROM public.${table} WHERE id = $1::uuid`,
          sender.principal.id,
        );
        phone = own?.phone ?? null;
      }

      const fromKind = sender ? (sender.principal.kind as 'farmer' | 'buyer') : 'visitor';
      const row = await audited(prisma, async (tx) => {
        const [inserted] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO public.support_message
             (from_auth_user_id, from_kind, name, phone, email, topic, body, source_digest)
           VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          sender?.principal.authUserId ?? null,
          fromKind,
          body.name,
          phone,
          body.email ?? null,
          body.topic,
          body.body,
          digest,
        );
        if (!inserted) throw new ApiFailure(500, 'empty', 'The message could not be recorded.');

        await writeAudit(tx, {
          entityType: 'support_message',
          entityId: inserted.id,
          // A visitor has no principal: `system` is the actor type for an act
          // with none, as on the product-report route.
          ...(sender
            ? { actorType: fromKind as 'farmer' | 'buyer', actorId: sender.principal.id }
            : { actorType: 'system' as const, actorId: null }),
          action: 'support_message.created',
          after: { from_kind: fromKind, topic: body.topic, status: 'new' },
        });
        return inserted;
      });

      // The sender learns it arrived, and nothing to enumerate or poll.
      return created({ received: true, id: row.id });
    },
  },
});
