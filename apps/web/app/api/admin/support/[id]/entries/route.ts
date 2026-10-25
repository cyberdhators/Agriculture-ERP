import {
  caseTransition,
  isSettledStatus,
  supportCaseEntrySchema,
  type StoredSupportStatus,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../../lib/api/audit';
import { internalError, notFound, unprocessable } from '../../../../../../lib/api/errors';
import { notifyAccount } from '../../../../../../lib/api/notify';
import { requirePermission } from '../../../../../../lib/api/permissions';
import { created, defineRoutes } from '../../../../../../lib/api/route';
import {
  CASE_ENTRY_SELECT,
  presentEntry,
  type CaseEntryRow,
} from '../../../../../../lib/api/support';
import { prisma } from '../../../../../../lib/db';

/**
 * POST /api/admin/support/:id/entries -- staff add to a support case
 * (2026-10-28): a REPLY to the person, an internal NOTE, or EVIDENCE (a link
 * with a line saying what it is). ADMINISTRATOR ONLY, then `support.handle`.
 *
 * A reply is what the person reads on the Help page ("Your messages to
 * CORWADO"); a signed-in sender is told by a FIXED in-app notice that never
 * carries the reply's text (lib/farmer-notices.ts). A visitor has no inbox:
 * the reply is kept on the case and the answer says `notified: false`, so
 * staff answer them by the phone or email they left. Notes and evidence are
 * staff-only and tell nobody.
 *
 * A reply may move the case on in the same transaction (`status`, usually
 * waiting), under the same rules as PATCH. Audited: support_case.replied for
 * a reply, support_case.updated for a note or evidence -- the kind and
 * whether a link was given, never the text.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin', 'supervisor'],
    bodySchema: supportCaseEntrySchema,
    handler: async ({ auth, body, params }) => {
      await requirePermission(auth, 'support.handle');
      const id = params.id ?? '';
      if (!UUID.test(id)) throw notFound();

      const outcome = await audited(prisma, async (tx) => {
        const [current] = await tx.$queryRawUnsafe<
          {
            status: StoredSupportStatus;
            resolution_note: string | null;
            from_auth_user_id: string | null;
          }[]
        >(
          `SELECT status, resolution_note, from_auth_user_id
             FROM public.support_message
            WHERE id = $1::uuid AND deleted_at IS NULL
            FOR UPDATE`,
          id,
        );
        if (!current) throw notFound();

        let statusChange: { from: string; to: string } | null = null;
        if (body.status !== undefined) {
          const move = caseTransition(
            current.status,
            body.status,
            current.resolution_note !== null,
          );
          if (!move.ok) throw unprocessable(move.rule);
          if (!move.same) {
            const handled = move.settles
              ? isSettledStatus(current.status)
                ? ''
                : ', handled_by = $3::uuid, handled_at = now()'
              : move.reopens
                ? ', handled_by = NULL, handled_at = NULL'
                : '';
            await tx.$executeRawUnsafe(
              `UPDATE public.support_message SET status = $2${handled}, updated_at = now()
                WHERE id = $1::uuid`,
              id,
              body.status,
              ...(handled.includes('$3') ? [auth.principal.id] : []),
            );
            statusChange = { from: current.status, to: body.status };
          }
        }
        if (!statusChange) {
          await tx.$executeRawUnsafe(
            `UPDATE public.support_message SET updated_at = now() WHERE id = $1::uuid`,
            id,
          );
        }

        const [entry] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO public.support_case_entry (support_message_id, kind, body, link, author_id)
           VALUES ($1::uuid, $2, $3, $4, $5::uuid) RETURNING id`,
          id,
          body.kind,
          body.body,
          body.link ?? null,
          auth.principal.id,
        );
        if (!entry) throw internalError();

        await writeAudit(tx, {
          entityType: 'support_message',
          entityId: id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: body.kind === 'reply' ? 'support_case.replied' : 'support_case.updated',
          before: statusChange ? { status: statusChange.from } : null,
          after: {
            entry: body.kind,
            entry_id: entry.id,
            link: body.link !== undefined,
            ...(statusChange ? { status: statusChange.to } : {}),
          },
        });

        let notified = false;
        if (body.kind === 'reply' && current.from_auth_user_id) {
          notified = await notifyAccount(
            tx,
            { authUserId: current.from_auth_user_id },
            'support_case_updated',
            { actorType: auth.role, actorId: auth.principal.id },
          );
        }
        const rows = await tx.$queryRawUnsafe<CaseEntryRow[]>(CASE_ENTRY_SELECT, id);
        const mine = rows.find((r) => r.id === entry.id);
        if (!mine) throw internalError();
        return { entry: presentEntry(mine), notified };
      });

      return created(outcome);
    },
  },
});
