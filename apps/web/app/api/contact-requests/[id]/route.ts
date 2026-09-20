import { ALL_ROLES } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import { ApiFailure, notFound } from '../../../../lib/api/errors';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { requireWriter, scopeCondition } from '../../../../lib/api/scope';
import { prisma } from '../../../../lib/db';

/**
 * PATCH /api/contact-requests/:id
 *
 * The officer records the outcome of the introduction: introduced, declined,
 * or no_answer. The note is free text about the call, not about a person.
 */

const OUTCOMES = ['introduced', 'declined', 'no_answer'] as const;
type Outcome = (typeof OUTCOMES)[number];

interface ContactRow {
  id: string;
  listing_id: string;
  farmer_id: string;
  buyer_name: string;
  buyer_phone: string;
  message: string | null;
  quantity: string | null;
  status: string;
  note: string | null;
  created_at: string;
  handled_at: string | null;
  handled_by: string | null;
}

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  PATCH: {
    roles: ALL_ROLES,
    handler: async (ctx) => {
      const auth = ctx.auth!;
      requireWriter(auth);

      const requestId = ctx.params.id;

      // Parse body
      let raw: unknown;
      try {
        raw = await ctx.request.json();
      } catch {
        throw new ApiFailure(400, 'invalid_json', 'The request body is not valid JSON.');
      }
      if (!raw || typeof raw !== 'object') {
        throw new ApiFailure(400, 'invalid_input', 'Expected a JSON object.');
      }
      const input = raw as Record<string, unknown>;

      const status = input.status as string;
      if (!OUTCOMES.includes(status as Outcome)) {
        throw new ApiFailure(
          400,
          'invalid_input',
          `status must be one of: ${OUTCOMES.join(', ')}.`,
        );
      }

      const note =
        typeof input.note === 'string' && input.note.trim().length > 0 ? input.note.trim() : null;

      // Scope check: the contact request's farmer must be in the caller's scope.
      const sc = scopeCondition(auth.scope, 'f.state_id', 'f.caseload_officer_id', 3);
      const scopeSql = sc.sql ? ` AND ${sc.sql}` : '';

      const [existing] = await prisma.$queryRawUnsafe<{ id: string; status: string }[]>(
        `SELECT cr.id, cr.status::text AS status
         FROM public.contact_request cr
         JOIN public.farmer f ON f.id = cr.farmer_id
         WHERE cr.id = $1::uuid AND f.deleted_at IS NULL${scopeSql}
         LIMIT 1`,
        requestId,
        ...sc.params,
      );

      if (!existing) throw notFound();

      if (existing.status !== 'new') {
        throw new ApiFailure(409, 'conflict', 'This contact request has already been handled.');
      }

      const row = await audited(prisma, async (tx) => {
        const rows = await tx.$queryRawUnsafe<ContactRow[]>(
          `UPDATE public.contact_request
           SET status = $2::contact_status,
               note = $3,
               handled_at = now(),
               handled_by = $4::uuid
           WHERE id = $1::uuid
           RETURNING id, listing_id, farmer_id, buyer_name, buyer_phone,
                     message, quantity, status::text AS status, note,
                     created_at::text AS created_at,
                     handled_at::text AS handled_at, handled_by`,
          requestId,
          status,
          note,
          auth.principal.id,
        );
        const updated = rows[0]!;

        await writeAudit(tx, {
          entityType: 'contact_request',
          entityId: updated.id,
          actorType: auth.role === 'officer' ? 'officer' : auth.role,
          actorId: auth.principal.id,
          action: 'contact_request.handled',
          before: { status: existing.status },
          after: { status, note },
        });

        return updated;
      });

      return ok(row);
    },
  },
});
