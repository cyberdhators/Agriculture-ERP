import {
  BUYER_ROLE,
  buyerCapabilities,
  buyerMayCancelRequest,
  purchaseRequestPatchSchema,
  type PurchaseRequestStatus,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import {
  buyerActor,
  loadOwnRequest,
  MARKET_BASE_WHERE,
  MARKET_FROM,
  checkRequestedItems,
  notifyFarmerOfCancel,
  notifyFarmerOfRequest,
  presentRequest,
} from '../../../../../lib/api/buyers';
import { forbidden, unprocessable } from '../../../../../lib/api/errors';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { buyerScope } from '../../../../../lib/api/scope';
import { prisma } from '../../../../../lib/db';

/**
 * GET and PATCH /api/buyer/purchase-requests/:id. B13, C-14B.11, C-14B.22.
 *
 * OWNERSHIP IS IN THE QUERY. `loadOwnRequest` puts the session's organisation
 * in the WHERE clause, so another organisation's request is not found -- a
 * 404 byte-identical to an id that never existed. Changing the id in the
 * address reaches nothing.
 *
 * The PATCH is the buyer's whole say over a request: edit a DRAFT's fields,
 * `submit` it, or `cancel` it while nobody has acted on it. A reviewer's
 * decisions are a different route an administrator holds.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [BUYER_ROLE],
    handler: async ({ auth, params }) => {
      const scope = buyerScope(auth);
      return ok(
        presentRequest(await loadOwnRequest(prisma, scope.organizationId, params.id ?? '')),
      );
    },
  },

  PATCH: {
    roles: [BUYER_ROLE],
    bodySchema: purchaseRequestPatchSchema,
    handler: async ({ auth, body, params }) => {
      const scope = buyerScope(auth);
      const id = params.id ?? '';
      const { action, ...fields } = body;
      const editing = Object.values(fields).some((v) => v !== undefined);

      await audited(prisma, async (tx) => {
        // Locked, so a reviewer's decision and this change cannot interleave.
        const current = await loadOwnRequest(tx, scope.organizationId, id, true);

        if (action === 'cancel') {
          if (editing) throw unprocessable('request_not_editable');
          if (!buyerMayCancelRequest(current.status as PurchaseRequestStatus)) {
            throw unprocessable('transition_not_allowed');
          }
          await tx.$executeRawUnsafe(
            `UPDATE public.purchase_request SET status = 'cancelled', updated_at = now()
              WHERE id = $1::uuid`,
            id,
          );
          await writeAudit(tx, {
            entityType: 'purchase_request',
            entityId: id,
            ...buyerActor(auth),
            action: 'purchase_request.cancelled',
            before: { status: current.status },
            after: { status: 'cancelled' },
          });
          // The farmer saw a sent request, so the farmer is told it is off. A
          // draft was never sent, so cancelling one tells nobody.
          if (current.status !== 'draft' && current.listing_id) {
            await notifyFarmerOfCancel(tx, current.listing_id, buyerActor(auth));
          }
          return;
        }

        if (editing || action === 'submit') {
          // Only a draft changes, and only a buyer still in good standing
          // changes it. Reading a rejected account's history is allowed;
          // editing it is not.
          if (current.status !== 'draft') throw unprocessable('request_not_editable');
          if (!buyerCapabilities(scope.verification).browse) throw forbidden();
        }

        if (editing) {
          const sets: string[] = [];
          const values: unknown[] = [];
          const changed: Record<string, unknown> = {};
          const casts: Record<string, string> = {
            unit: '::public.listing_unit',
            required_by: '::date',
          };
          for (const [key, value] of Object.entries(fields)) {
            if (value === undefined) continue;
            values.push(value);
            sets.push(`${key} = $${values.length}${casts[key] ?? ''}`);
            changed[key] = value;
          }
          values.push(id);
          await tx.$executeRawUnsafe(
            `UPDATE public.purchase_request SET ${sets.join(', ')}, updated_at = now()
              WHERE id = $${values.length}::uuid`,
            ...values,
          );
          await writeAudit(tx, {
            entityType: 'purchase_request',
            entityId: id,
            ...buyerActor(auth),
            action: 'purchase_request.updated',
            after: changed,
          });
        }

        if (action === 'submit') {
          if (!buyerCapabilities(scope.verification).request) {
            throw unprocessable('buyer_not_verified');
          }
          if (current.listing_id) {
            // The listing must still be in the market, and the request must
            // fit it -- the same checks the cart makes (2026-10-08).
            const [still] = await tx.$queryRawUnsafe<{ id: string }[]>(
              `SELECT pl.id ${MARKET_FROM} WHERE ${MARKET_BASE_WHERE} AND pl.id = $1::uuid`,
              current.listing_id,
            );
            if (!still) throw unprocessable('listing_not_available');
            await checkRequestedItems(
              tx,
              scope.organizationId,
              [
                {
                  listing_id: current.listing_id,
                  quantity: fields.quantity ?? Number(current.quantity),
                  unit: fields.unit ?? current.unit,
                },
              ],
              () => 'quantity',
            );
          }
          await tx.$executeRawUnsafe(
            `UPDATE public.purchase_request
                SET status = 'submitted', submitted_at = now(), updated_at = now()
              WHERE id = $1::uuid`,
            id,
          );
          await writeAudit(tx, {
            entityType: 'purchase_request',
            entityId: id,
            ...buyerActor(auth),
            action: 'purchase_request.submitted',
            before: { status: 'draft' },
            after: { status: 'submitted' },
          });
          if (current.listing_id) {
            await notifyFarmerOfRequest(tx, current.listing_id, buyerActor(auth));
          }
        }
      });

      return ok(presentRequest(await loadOwnRequest(prisma, scope.organizationId, id)));
    },
  },
});
