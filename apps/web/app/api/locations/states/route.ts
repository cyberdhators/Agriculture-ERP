import { defineRoutes, ok } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/locations/states -- the states, for the email sign-up form.
 *
 * PUBLIC, BECAUSE THE APPLICANT HAS NO ACCOUNT YET. Since 2026-11-02 (owner,
 * 2026-10-26: "make the registration form compulsory, details should be
 * fixed") email sign-up REQUIRES the state, and the full location bundle
 * (GET /api/locations) is read with a session. This answers the state names
 * and codes only, from the ACTIVE view: place names, nothing personal, and
 * nothing written. POST /api/buyer/register checks the state again.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: 'public',
    handler: async () => {
      const states = await prisma.$queryRawUnsafe<{ id: string; name: string }[]>(
        'SELECT id, name FROM public.state_active ORDER BY name',
      );
      return ok({ states });
    },
  },
});
