import { revealContactSchema, type AccountDetailKind } from '@agri-erp/shared';

import { accountRowQuery, type AccountSqlRow } from '../../../../../../../lib/api/admin-accounts';
import { audited, writeAudit } from '../../../../../../../lib/api/audit';
import { notFound } from '../../../../../../../lib/api/errors';
import { requirePermission } from '../../../../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../../../../lib/api/route';
import { prisma } from '../../../../../../../lib/db';
import { authEmailFacts } from '../../../../../../../lib/supabase/admin';

/**
 * POST /api/admin/accounts/:kind/:id/reveal { field: 'phone' | 'email' } --
 * show one private contact in clear (2026-10-28; infographic "Profile
 * creation and visibility": "Private contact (visible to authorized staff
 * only)"). ADMINISTRATOR ONLY, then `support.handle` -- the staff who answer
 * people. A moderator sees the masked form only.
 *
 * EVERY REVEAL IS AUDITED (account.contact_revealed), naming the field and
 * never the value; the audit row is written in the same transaction before
 * the value is returned, so a value is never shown without its record. The
 * answer is not cached.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin', 'supervisor'],
    bodySchema: revealContactSchema,
    handler: async ({ auth, body, params }) => {
      await requirePermission(auth, 'support.handle');
      const kind = params.kind ?? '';
      const id = params.id ?? '';
      if ((kind !== 'farmer' && kind !== 'buyer') || !UUID.test(id)) throw notFound();

      const q = accountRowQuery(kind as AccountDetailKind, id);
      const [row] = await prisma.$queryRawUnsafe<AccountSqlRow[]>(q.sql, ...q.params);
      if (!row) throw notFound();

      let value: string | null = null;
      if (body.field === 'phone') value = row.phone;
      else if (row.sign_in === 'email' && row.auth_user_id) {
        value = (await authEmailFacts(row.auth_user_id))?.email ?? null;
      }
      if (!value) throw notFound();

      await audited(prisma, async (tx) => {
        await writeAudit(tx, {
          entityType: row.farmer_id ? 'farmer' : 'buyer',
          entityId: (row.farmer_id ?? row.buyer_id)!,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'account.contact_revealed',
          after: { field: body.field },
        });
      });
      return ok({ field: body.field, value }, { 'cache-control': 'no-store' });
    },
  },
});
