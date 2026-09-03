import { ALL_ROLES } from '@agri-erp/shared';

import { defineRoutes, empty, ok } from '../../../lib/api/route';
import { prisma } from '../../../lib/db';

/**
 * The location hierarchy as one file, for the officer's device. C-2.2, C-2.4,
 * C-2.5.
 *
 * Reads the ACTIVE views, so a soft-deleted location is in no bundle.
 *
 * The version identifier is the SHA-256 recorded by `pnpm locations:bundle`. A
 * device sends it back as If-None-Match and gets 304 with no body, which is
 * C-2.5: it can tell whether the hierarchy changed without downloading it.
 *
 * Not scoped by state. Every officer needs the whole hierarchy to register a
 * farmer offline, and a location list is reference data, not a record.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ALL_ROLES,
    handler: async ({ request }) => {
      const [bundle] = await prisma.$queryRawUnsafe<{ version: string }[]>(
        'SELECT version FROM public.location_bundle WHERE id = 1',
      );

      // No bundle has been built yet. Not an error: the hierarchy is simply not
      // published, and the device should keep whatever it has.
      const version = bundle?.version ?? null;
      const etag = version ? `"${version}"` : null;

      if (etag && request.headers.get('if-none-match') === etag) {
        return empty(304, { etag });
      }

      const states = await prisma.$queryRawUnsafe(
        'SELECT id, name FROM public.state_active ORDER BY id',
      );
      const counties = await prisma.$queryRawUnsafe(
        'SELECT id, name, state_id FROM public.county_active ORDER BY id',
      );
      const payams = await prisma.$queryRawUnsafe(
        'SELECT id, name, county_id, state_id FROM public.payam_active ORDER BY id',
      );

      return ok({ version, states, counties, payams }, etag ? { etag } : undefined);
    },
  },
});
