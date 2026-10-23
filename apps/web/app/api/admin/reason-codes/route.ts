import { reasonCodesFor, reasonCodesQuerySchema, readSetting } from '@agri-erp/shared';

import { parseQuery } from '../../../../lib/api/market-posts';
import { requirePermission } from '../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { currentSetting, settingsTablesPresent } from '../../../../lib/api/settings';

/**
 * GET /api/admin/reason-codes?applies_to=account|listing|profile|report
 * (2026-10-25, settings phase 1). The ACTIVE moderation reason codes for one
 * kind of decision, for the suspend and report dialogs' dropdown.
 * ADMINISTRATOR ONLY -- every decision route those dialogs call is -- and
 * then `content.moderate`, the permission that decides suspension. Managing
 * the list is /api/admin/settings, under `settings.manage`.
 *
 * Before the settings migration is applied this answers the default codes, so
 * the dialogs work either way. Read-only.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin'],
    handler: async ({ auth, request }) => {
      await requirePermission(auth, 'content.moderate');
      const { applies_to } = parseQuery(request, reasonCodesQuerySchema);
      const setting = (await settingsTablesPresent())
        ? (await currentSetting('reason_codes')).value
        : readSetting('reason_codes', undefined);
      return ok(reasonCodesFor(setting, applies_to));
    },
  },
});
