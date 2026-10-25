import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  adminAccountFilterSchema,
  decodeCursor,
  encodeCursor,
  holdsPermission,
  zodErrorToApiError,
} from '@agri-erp/shared';

import {
  accountListQuery,
  presentAccountRow,
  type AccountSqlRow,
} from '../../../../lib/api/admin-accounts';
import { ApiFailure, forbidden, invalidCursor } from '../../../../lib/api/errors';
import { permissionsOf } from '../../../../lib/api/permissions';
import { defineRoutes, paged } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * GET /api/admin/accounts -- USERS AND ORGANIZATIONS (2026-10-28; the
 * specification, section 4). Every account in one list: sign-in accounts
 * (phone or email; their farmer and buyer records together), farmers an
 * officer registered with no sign-in, and organisational profiles. Newest
 * first; keyset pages.
 *
 * ADMINISTRATOR ONLY, and then `support.handle` or `content.moderate` (the
 * staff who assist people and the staff who moderate them). Searching by
 * CONTACT (digits matching a phone) is "as permitted": only for
 * `support.handle`; for anyone else the digits search names and numbers only.
 *
 * Columns: actor types, organisations, joined, first sign-in, last active,
 * account status, verification, publication, advisory. No phone or email is
 * returned here, masked or not -- the account page shows them masked.
 * Deleted accounts are never listed (the deletion law).
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin'],
    handler: async ({ auth, request }) => {
      const permissions = await permissionsOf(auth);
      const mayUseContact = holdsPermission(permissions, 'support.handle');
      if (!mayUseContact && !holdsPermission(permissions, 'content.moderate')) throw forbidden();

      const parsed = adminAccountFilterSchema.safeParse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      if (!parsed.success) {
        const { body } = zodErrorToApiError(parsed.error);
        throw new ApiFailure(400, body.error.code, body.error.message, body.error.fields);
      }
      const filter = parsed.data;

      let limit = DEFAULT_LIMIT;
      if (filter.limit !== undefined) {
        const n = Number(filter.limit);
        if (!Number.isInteger(n) || n < 1) throw invalidCursor();
        limit = Math.min(n, MAX_LIMIT);
      }
      let cursor: { createdAt: string; id: string } | null = null;
      if (filter.cursor !== undefined) {
        const decoded = decodeCursor(filter.cursor);
        if (!decoded) throw invalidCursor();
        cursor = { createdAt: decoded.createdAt, id: decoded.id };
      }

      const { sql, params } = accountListQuery(filter, { mayUseContact, limit, cursor });
      const rows = await prisma.$queryRawUnsafe<AccountSqlRow[]>(sql, ...params);
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit).map(presentAccountRow);
      const last = page[page.length - 1];
      return paged(page, {
        cursor: hasMore && last ? encodeCursor({ createdAt: last.joined_at, id: last.id }) : null,
        hasMore,
      });
    },
  },
});
