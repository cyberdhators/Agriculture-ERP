import { defineRoutes, ok } from '../../../../lib/api/route';
import { publicSettings } from '../../../../lib/api/settings';

/**
 * GET /api/settings/public (2026-10-25, settings phase 1). PUBLIC, READ-ONLY.
 *
 * What a visitor's page shows: the service name and About text, the support
 * contacts and help links CORWADO chose to publish, and the maintenance
 * banner. A WHITELIST (lib/api/settings.ts publicSettings): no version, no
 * staff name, no reason code, nothing about integrations or security. Each
 * value falls back to what the site showed before settings existed, so an
 * unset or not-yet-migrated database changes nothing. Writes nothing.
 *
 * Cached for a minute at the edge: the banner and footer read it on every
 * page, and a minute's delay after a save is acceptable for both.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: 'public',
    handler: async () =>
      ok(await publicSettings(), {
        'cache-control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=300',
      }),
  },
});
