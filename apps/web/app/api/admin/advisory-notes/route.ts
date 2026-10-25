import { advisoryNoteQueueSchema, holdsPermission } from '@agri-erp/shared';

import {
  STAFF_NOTE_SELECT,
  type StaffNoteRow,
  presentStaffNote,
} from '../../../../lib/api/advisory-notes';
import { forbidden } from '../../../../lib/api/errors';
import { invalidField } from '../../../../lib/api/market-posts';
import { permissionsOf } from '../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/admin/advisory-notes?status= -- official advisory notes from
 * approved advisers, by status (default `submitted`, oldest first; the others
 * newest first). 2026-10-28, lane-security. Advice & Learning's review side
 * of the approved-adviser channel.
 *
 * Administrators holding "Moderate content and listings" or "Publish
 * content" -- the two Advice & Learning reviewers. Shows the adviser's public
 * name only, never a sign-in id.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only'],
    handler: async ({ auth, request }) => {
      const permissions = await permissionsOf(auth);
      if (
        !holdsPermission(permissions, 'content.moderate') &&
        !holdsPermission(permissions, 'content.publish')
      ) {
        throw forbidden();
      }
      const parsed = advisoryNoteQueueSchema.safeParse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      if (!parsed.success) throw invalidField('status', 'Choose a status from the list.');
      const status = parsed.data.status;
      const rows = await prisma.$queryRawUnsafe<StaffNoteRow[]>(
        `${STAFF_NOTE_SELECT}
          WHERE n.deleted_at IS NULL AND n.status = $1
          ORDER BY n.updated_at ${status === 'submitted' ? 'ASC' : 'DESC'}, n.id
          LIMIT 100`,
        status,
      );
      return ok(rows.map(presentStaffNote));
    },
  },
});
