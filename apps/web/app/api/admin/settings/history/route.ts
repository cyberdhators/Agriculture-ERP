import { SETTINGS_LIMITS, readSetting, settingHistoryQuerySchema } from '@agri-erp/shared';

import { parseQuery } from '../../../../../lib/api/market-posts';
import { requirePermission } from '../../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * GET /api/admin/settings/history?key= (2026-10-25, settings phase 1).
 * ADMINISTRATOR ONLY, then `settings.manage`. The saved versions of one
 * setting, newest first (the latest 50): every earlier value is kept, and
 * this is where it is read back. Read-only.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin'],
    handler: async ({ auth, request }) => {
      await requirePermission(auth, 'settings.manage');
      const { key } = parseQuery(request, settingHistoryQuerySchema);
      const rows = await prisma.$queryRawUnsafe<
        { version: number; value: unknown; changed_at: Date; changed_by: string | null }[]
      >(
        `SELECT s.version, s.value, s.changed_at, u.name AS changed_by
           FROM public.setting_version s
           LEFT JOIN public."user" u ON u.id = s.changed_by
          WHERE s.key = $1
          ORDER BY s.version DESC
          LIMIT ${SETTINGS_LIMITS.historyMax}`,
        key,
      );
      return ok(
        rows.map((r) => ({
          version: r.version,
          value: readSetting(key, r.value),
          changed_at: r.changed_at.toISOString(),
          changed_by: r.changed_by,
        })),
      );
    },
  },
});
