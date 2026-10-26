import { ratingModerationQuerySchema, type ModerationRating } from '@agri-erp/shared';

import { parseQuery } from '../../../../lib/api/market-posts';
import { requirePermission } from '../../../../lib/api/permissions';
import { MODERATION_RATING_SELECT, presentModerationRating } from '../../../../lib/api/ratings';
import { defineRoutes, paged } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/admin/ratings -- the moderators' ratings queue (2026-11-03,
 * lane-trust). Staff holding content.moderate, as every marketplace
 * moderation queue. `filter`: `reported` (the default: open reports, not yet
 * hidden), `hidden`, or `all`. Newest first, at most 100.
 *
 * Each rating with its stars, comment, the report's reason and note, and the
 * public names of both parties. Never a sign-in, phone or record id of
 * either party: a moderator judges the words, not the people.
 */
const WHERE: Record<string, string> = {
  reported: 'r.reported_at IS NOT NULL AND r.hidden_at IS NULL',
  hidden: 'r.hidden_at IS NOT NULL',
  all: 'true',
};

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only'],
    handler: async ({ auth, request }) => {
      await requirePermission(auth, 'content.moderate');
      const query = parseQuery(request, ratingModerationQuerySchema);
      const filter = query.filter ?? 'reported';
      const rows = await prisma.$queryRawUnsafe<Parameters<typeof presentModerationRating>[0][]>(
        `${MODERATION_RATING_SELECT}
          WHERE r.deleted_at IS NULL AND ${WHERE[filter]}
          ORDER BY COALESCE(r.reported_at, r.created_at) DESC, r.id DESC
          LIMIT 100`,
      );
      const data: ModerationRating[] = rows.map(presentModerationRating);
      return paged(data, { cursor: null, hasMore: false });
    },
  },
});
