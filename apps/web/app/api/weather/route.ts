import {
  attribution,
  loadForecasts,
  loadLocations,
  presentLocation,
} from '../../../lib/api/weather';
import { defineRoutes, ok } from '../../../lib/api/route';
import { prisma } from '../../../lib/db';

/**
 * GET /api/weather -- the tile (C-16.8). Current conditions and a short daily
 * forecast for the locations the caller may see: admin all, supervisor and
 * read_only their state, an officer their county. No parameters in this
 * version. Empty is a success: a caller with no locations gets 200 and []
 * (C-16.9). Never fetches (C-16.6). Attribution rides in the payload so the
 * server owns the wording of a licence condition (C-16.10).
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only', 'officer'],
    handler: async ({ auth }) => {
      const rows = await loadLocations(prisma, auth);
      const forecasts = await loadForecasts(
        prisma,
        rows.map((r) => r.id),
      );
      return ok(
        rows.map((r) => presentLocation(r, forecasts)),
        undefined,
        {
          attribution: attribution(),
        },
      );
    },
  },
});
