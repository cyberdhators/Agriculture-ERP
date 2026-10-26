import { BUYER_ROLE, FARMER_ROLE, savedSearchPatchSchema } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { notFound } from '../../../../../lib/api/errors';
import { checkId } from '../../../../../lib/api/market-posts';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import {
  SAVED_SEARCH_COLUMNS,
  SAVED_SEARCH_FROM,
  auditedCriteria,
  ownerOf,
  presentSavedSearch,
  searchActor,
  type SavedSearchRow,
} from '../../../../../lib/api/saved-searches';
import { prisma } from '../../../../../lib/db';

/**
 * /api/account/saved-searches/:id -- one of the caller's own saved searches
 * (2026-11-03). Another account's search, a deleted one or a missing one is
 * 404 alike, so nobody can probe for others' searches.
 *
 * PATCH { paused } pauses (no alerts) or resumes it; saved_search.paused /
 * saved_search.resumed. Asking for the state it is already in changes
 * nothing and writes no audit row.
 *
 * DELETE removes it (soft: deleted_at); saved_search.deleted. It stops
 * alerting at once and no longer counts towards the limit.
 */

async function loadOwn(
  tx: { $queryRawUnsafe: typeof prisma.$queryRawUnsafe },
  id: string,
  owner: string,
): Promise<SavedSearchRow> {
  const [row] = await tx.$queryRawUnsafe<SavedSearchRow[]>(
    `SELECT ${SAVED_SEARCH_COLUMNS} ${SAVED_SEARCH_FROM}
      WHERE s.id = $1::uuid AND s.auth_user_id = $2::uuid AND s.deleted_at IS NULL
      FOR UPDATE OF s`,
    id,
    owner,
  );
  if (!row) throw notFound();
  return row;
}

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  PATCH: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: savedSearchPatchSchema,
    handler: async ({ auth, body, params, deviceId }) => {
      const id = checkId(params.id);
      const owner = ownerOf(auth);
      const row = await audited(prisma, async (tx) => {
        const current = await loadOwn(tx, id, owner);
        const paused = current.paused_at !== null;
        if (paused === body.paused) return current;
        await tx.$executeRawUnsafe(
          `UPDATE public.saved_search
              SET paused_at = CASE WHEN $2 THEN now() ELSE NULL END, updated_at = now()
            WHERE id = $1::uuid`,
          id,
          body.paused,
        );
        await writeAudit(tx, {
          entityType: 'saved_search',
          entityId: id,
          ...searchActor(auth),
          action: body.paused ? 'saved_search.paused' : 'saved_search.resumed',
          deviceId,
          before: { paused },
          after: { paused: body.paused },
        });
        return loadOwn(tx, id, owner);
      });
      return ok(presentSavedSearch(row));
    },
  },
  DELETE: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth, params, deviceId }) => {
      const id = checkId(params.id);
      const owner = ownerOf(auth);
      await audited(prisma, async (tx) => {
        const current = await loadOwn(tx, id, owner);
        await tx.$executeRawUnsafe(
          `UPDATE public.saved_search SET deleted_at = now(), updated_at = now()
            WHERE id = $1::uuid`,
          id,
        );
        await writeAudit(tx, {
          entityType: 'saved_search',
          entityId: id,
          ...searchActor(auth),
          action: 'saved_search.deleted',
          deviceId,
          before: auditedCriteria(current),
          after: { deleted: true },
        });
      });
      return ok({ id, deleted: true });
    },
  },
});
