import { requirePermission } from '../../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * GET /api/admin/notices/acknowledgements (2026-10-25, settings phase 1).
 * ADMINISTRATOR ONLY, then `settings.manage`. READ-ONLY.
 *
 * How many accounts accepted each consent text version, from the consent
 * records that already exist (public.consent): COUNTS by text version and
 * language, never a name, a phone or an id.
 *
 *   accepted  -- registrations that agreed to this version (distinct farmer
 *                records), live records only: a soft-deleted farmer is not
 *                counted, as the deletion law requires.
 *   current   -- of those, how many hold it as their current consent, not
 *                withdrawn.
 *
 * Grouped by the recorded text_version as it was written ('v1.3-en'), so an
 * old version recorded before notices were stored is still counted.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin'],
    handler: async ({ auth }) => {
      await requirePermission(auth, 'settings.manage');
      const rows = await prisma.$queryRawUnsafe<
        { text_version: string; language: string; accepted: number; current: number }[]
      >(
        `SELECT c.text_version, c.language::text AS language,
                count(DISTINCT c.farmer_id)::int AS accepted,
                count(DISTINCT c.farmer_id) FILTER (
                  WHERE f.consent_id = c.id AND c.withdrawn_at IS NULL
                )::int AS current
           FROM public.consent c
           JOIN public.farmer f ON f.id = c.farmer_id AND f.deleted_at IS NULL
          WHERE c.granted
          GROUP BY c.text_version, c.language
          ORDER BY c.text_version DESC, c.language`,
      );
      return ok(rows);
    },
  },
});
