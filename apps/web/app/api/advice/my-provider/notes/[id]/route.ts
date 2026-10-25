import {
  type AdvisoryNoteInput,
  BUYER_ROLE,
  FARMER_ROLE,
  advisoryNoteInputSchema,
} from '@agri-erp/shared';

import { loadOwnProvider } from '../../../../../../lib/api/advice';
import {
  NOTE_COLUMNS,
  type NoteRow,
  activeApprovalOf,
  ownNote,
  presentOwnNote,
} from '../../../../../../lib/api/advisory-notes';
import { audited, writeAudit } from '../../../../../../lib/api/audit';
import { notFound, unprocessable } from '../../../../../../lib/api/errors';
import { checkId } from '../../../../../../lib/api/market-posts';
import { actorOf, me } from '../../../../../../lib/api/messaging';
import { defineRoutes, ok } from '../../../../../../lib/api/route';
import { prisma } from '../../../../../../lib/db';

/**
 * /api/advice/my-provider/notes/:id -- one of the caller's own advisory notes
 * (2026-10-28).
 *
 * PUT    edit a RETURNED note and send it back for review (-> submitted), only
 *        while the approval stands and is not suspended. Audited
 *        `advisory_note.submitted` (from returned).
 * DELETE withdraw a submitted or returned note (-> withdrawn; the row stays).
 *        Audited `advisory_note.withdrawn`.
 *
 * Another account's note is 404, as a missing one.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  PUT: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: advisoryNoteInputSchema,
    handler: async ({ auth, body: raw, params }) => {
      const body = raw as AdvisoryNoteInput;
      const id = checkId(params.id);
      const owner = me(auth);
      const row = await audited(prisma, async (tx) => {
        const provider = await loadOwnProvider(tx, owner, true);
        if (!provider) throw notFound();
        const note = await ownNote(tx, provider.id, id);
        if (!note) throw notFound();
        if (note.status !== 'returned') throw unprocessable('advisory_note_not_allowed');
        const applicationId = await activeApprovalOf(tx, provider.id);
        if (!applicationId) throw unprocessable('advisory_note_not_approved');

        const [updated] = await tx.$queryRawUnsafe<NoteRow[]>(
          `UPDATE public.advisory_note n
              SET title = $2, topics = $3::text[], language = $4, body = $5,
                  status = 'submitted', application_id = $6::uuid, updated_at = now()
            WHERE n.id = $1::uuid
            RETURNING ${NOTE_COLUMNS}`,
          id,
          body.title,
          body.topics,
          body.language,
          body.body,
          applicationId,
        );
        await writeAudit(tx, {
          entityType: 'advisory_note',
          entityId: id,
          ...actorOf(auth),
          action: 'advisory_note.submitted',
          before: { status: 'returned' },
          after: { status: 'submitted', provider_id: provider.id },
        });
        return updated as NoteRow;
      });
      return ok(presentOwnNote(row));
    },
  },

  DELETE: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth, params }) => {
      const id = checkId(params.id);
      const owner = me(auth);
      const row = await audited(prisma, async (tx) => {
        const provider = await loadOwnProvider(tx, owner, true);
        if (!provider) throw notFound();
        const note = await ownNote(tx, provider.id, id);
        if (!note) throw notFound();
        if (note.status !== 'submitted' && note.status !== 'returned') {
          throw unprocessable('advisory_note_not_allowed');
        }
        const [updated] = await tx.$queryRawUnsafe<NoteRow[]>(
          `UPDATE public.advisory_note n SET status = 'withdrawn', updated_at = now()
            WHERE n.id = $1::uuid
            RETURNING ${NOTE_COLUMNS}`,
          id,
        );
        await writeAudit(tx, {
          entityType: 'advisory_note',
          entityId: id,
          ...actorOf(auth),
          action: 'advisory_note.withdrawn',
          before: { status: note.status },
          after: { status: 'withdrawn' },
        });
        return updated as NoteRow;
      });
      return ok(presentOwnNote(row));
    },
  },
});
