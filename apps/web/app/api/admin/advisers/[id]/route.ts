import {
  STAFF_APPLICATION_SELECT,
  presentStaffApplication,
  type StaffApplicationRow,
} from '../../../../../lib/api/adviser-approval';
import { notFound } from '../../../../../lib/api/errors';
import { checkId } from '../../../../../lib/api/market-posts';
import { requirePermission } from '../../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * GET /api/admin/advisers/:id -- one adviser application with its provider's
 * profile and the account's side and standing (2026-10-24). ADMINISTRATOR
 * ONLY, and then `content.moderate`. Read-only.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only'],
    handler: async ({ auth, params }) => {
      await requirePermission(auth, 'content.moderate');
      const [row] = await prisma.$queryRawUnsafe<StaffApplicationRow[]>(
        `${STAFF_APPLICATION_SELECT}
          WHERE a.id = $1::uuid AND a.deleted_at IS NULL`,
        checkId(params.id),
      );
      if (!row) throw notFound();
      return ok(presentStaffApplication(row));
    },
  },
});
