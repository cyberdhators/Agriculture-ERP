import {
  BUYER_ROLE,
  FARMER_ROLE,
  SAVED_SEARCH_LIMIT,
  SAVED_SEARCH_MESSAGES,
  sameSavedSearch,
  savedSearchCriteria,
  savedSearchSchema,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import { unprocessable } from '../../../../lib/api/errors';
import { invalidField } from '../../../../lib/api/market-posts';
import { created, defineRoutes, ok, paged } from '../../../../lib/api/route';
import {
  SAVED_SEARCH_COLUMNS,
  SAVED_SEARCH_FROM,
  auditedCriteria,
  ownerOf,
  presentSavedSearch,
  searchActor,
  type SavedSearchRow,
} from '../../../../lib/api/saved-searches';
import { prisma } from '../../../../lib/db';

/**
 * /api/account/saved-searches -- the caller's own saved searches (2026-11-03,
 * owner-approved). docs/DECISIONS.md, "Saved searches".
 *
 * GET lists the caller's live searches, newest first: what each asks for and
 * whether it is paused. Nobody else's are readable.
 *
 * POST saves one: produce listings or buying requests, a product word or a
 * category (or both), an optional state and, for listings, an optional
 * highest price. At most SAVED_SEARCH_LIMIT live per account
 * (saved_search_limit). Saving the same search again returns the one already
 * saved. Audited as saved_search.created with the criteria only.
 *
 * Any signed-in account: a phone account (farmer) or an email account
 * (buyer), keyed by the sign-in, so one account has one list.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth }) => {
      const rows = await prisma.$queryRawUnsafe<SavedSearchRow[]>(
        `SELECT ${SAVED_SEARCH_COLUMNS} ${SAVED_SEARCH_FROM}
          WHERE s.auth_user_id = $1::uuid AND s.deleted_at IS NULL
          ORDER BY s.created_at DESC, s.id DESC LIMIT ${SAVED_SEARCH_LIMIT * 2}`,
        ownerOf(auth),
      );
      return paged(rows.map(presentSavedSearch), { cursor: null, hasMore: false });
    },
  },
  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: savedSearchSchema,
    handler: async ({ auth, body, deviceId }) => {
      const owner = ownerOf(auth);
      const wanted = savedSearchCriteria(body);
      const result = await audited(prisma, async (tx) => {
        // One saver at a time per account, so two quick saves cannot pass the limit.
        // Wrapped so the result is a number, not `void`, which the driver
        // cannot read (2026-11-03 live test: P2010, every save answered 500).
        await tx.$queryRawUnsafe(
          `SELECT 1 AS locked
             FROM (SELECT pg_advisory_xact_lock(hashtext('saved_search:' || $1::text))) l`,
          owner,
        );
        if (wanted.state_id) {
          const [state] = await tx.$queryRawUnsafe<{ id: string }[]>(
            'SELECT id FROM public.state WHERE id = $1 AND deleted_at IS NULL',
            wanted.state_id,
          );
          if (!state) throw invalidField('state_id', SAVED_SEARCH_MESSAGES.stateInvalid);
        }
        const live = await tx.$queryRawUnsafe<SavedSearchRow[]>(
          `SELECT ${SAVED_SEARCH_COLUMNS} ${SAVED_SEARCH_FROM}
            WHERE s.auth_user_id = $1::uuid AND s.deleted_at IS NULL`,
          owner,
        );
        const same = live.find((row) => sameSavedSearch(presentSavedSearch(row), wanted));
        if (same) return { row: same, fresh: false };
        if (live.length >= SAVED_SEARCH_LIMIT) throw unprocessable('saved_search_limit');
        const [row] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO public.saved_search
             (auth_user_id, target, product_name, category, state_id, max_price_ssp)
           VALUES ($1::uuid, $2, $3, $4::public.listing_category, $5, $6::numeric)
           RETURNING id`,
          owner,
          wanted.target,
          wanted.product_name,
          wanted.category,
          wanted.state_id,
          wanted.max_price_ssp,
        );
        const [saved] = await tx.$queryRawUnsafe<SavedSearchRow[]>(
          `SELECT ${SAVED_SEARCH_COLUMNS} ${SAVED_SEARCH_FROM} WHERE s.id = $1::uuid`,
          row!.id,
        );
        await writeAudit(tx, {
          entityType: 'saved_search',
          entityId: row!.id,
          ...searchActor(auth),
          action: 'saved_search.created',
          deviceId,
          after: auditedCriteria(saved!),
        });
        return { row: saved!, fresh: true };
      });
      const out = presentSavedSearch(result.row);
      return result.fresh ? created(out) : ok(out);
    },
  },
});
