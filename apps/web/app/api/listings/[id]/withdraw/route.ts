import { listingWithdrawSchema } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { notFound, unprocessable } from '../../../../../lib/api/errors';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { requireWriter } from '../../../../../lib/api/scope';
import { prisma } from '../../../../../lib/db';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/listings/:id/withdraw -- staff take a listing off the market
 * (2026-10-08).
 *
 * The marketplace's "Withdraw listing" button used to change only the staff
 * member's own browser tab: the listing stayed live for every buyer. This is
 * the real write.
 *
 * Who: an administrator, any listing; a supervisor, a listing in their own
 * state (any other is 404, as if it did not exist). Read-only staff and
 * officers are refused. Only a listing that is live can be withdrawn.
 *
 * The farmer is told, with the reason, in their alerts -- there is no reason
 * column on the listing, and the alert is where a farmer looks. The reason is
 * also kept in the audit log. Existing requests on the listing are untouched:
 * buyer and farmer may still settle what they had agreed.
 */
const NOTICE_TITLE = 'CORWADO took one of your listings off the market';

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin', 'supervisor'],
    bodySchema: listingWithdrawSchema,
    handler: async ({ auth, body, params }) => {
      requireWriter(auth);
      const id = params.id ?? '';
      if (!UUID.test(id)) throw notFound();

      const outcome = await audited(prisma, async (tx) => {
        const [listing] = await tx.$queryRawUnsafe<
          { id: string; status: string; state_id: string; farmer_id: string; title: string }[]
        >(
          `SELECT id, status::text AS status, state_id, farmer_id, title
             FROM public.produce_listing
            WHERE id = $1::uuid AND deleted_at IS NULL
            FOR UPDATE`,
          id,
        );
        if (!listing) throw notFound();
        if (auth.scope.kind === 'state' && listing.state_id !== auth.scope.stateId) {
          throw notFound();
        }
        if (listing.status !== 'listed') throw unprocessable('transition_not_allowed');

        await tx.$executeRawUnsafe(
          `UPDATE public.produce_listing SET status = 'withdrawn', updated_at = now()
            WHERE id = $1::uuid`,
          id,
        );
        const actor = { actorType: auth.role, actorId: auth.principal.id } as const;
        await writeAudit(tx, {
          entityType: 'produce_listing',
          entityId: id,
          ...actor,
          action: 'listing.status_changed',
          before: { status: 'listed' },
          after: { status: 'withdrawn', by: 'staff', reason: body.reason },
        });

        const [note] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO public.notification (farmer_id, channel, title, body)
           VALUES ($1::uuid, 'in_app', $2, $3) RETURNING id`,
          listing.farmer_id,
          NOTICE_TITLE,
          `"${listing.title}" is no longer in the marketplace. Reason: ${body.reason}`,
        );
        await writeAudit(tx, {
          entityType: 'notification',
          entityId: note!.id,
          ...actor,
          action: 'notification.created',
          after: { recipient: 'farmer', notice: 'listing_withdrawn_by_staff' },
        });
        return { id, status: 'withdrawn' as const };
      });
      return ok(outcome);
    },
  },
});
