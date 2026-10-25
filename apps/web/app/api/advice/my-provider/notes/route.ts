import {
  type AdvisoryNoteInput,
  BUYER_ROLE,
  FARMER_ROLE,
  advisoryNoteInputSchema,
} from '@agri-erp/shared';

import { loadOwnProvider } from '../../../../../lib/api/advice';
import {
  NOTE_COLUMNS,
  type NoteRow,
  activeApprovalOf,
  presentOwnNote,
} from '../../../../../lib/api/advisory-notes';
import { audited, writeAudit } from '../../../../../lib/api/audit';
import { unprocessable } from '../../../../../lib/api/errors';
import { actorOf, me } from '../../../../../lib/api/messaging';
import { created, defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * /api/advice/my-provider/notes -- the caller's OFFICIAL ADVISORY NOTES
 * (2026-10-28, lane-security): the approved-adviser channel.
 *
 * GET   the caller's own notes, newest first (any status; none without a
 *       profile).
 * POST  submit a new note for CORWADO's review. ONLY while the caller's
 *       personal advice profile holds an approval that stands and is not
 *       suspended (422 advisory_note_not_approved otherwise). Audited
 *       `advisory_note.submitted` with ids and status only, never the text.
 *
 * Every account may advise; only approval adds this channel. Nothing else
 * about the account depends on it.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth }) => {
      const provider = await loadOwnProvider(prisma, me(auth));
      if (!provider) return ok({ may_submit: false, notes: [] });
      const rows = await prisma.$queryRawUnsafe<NoteRow[]>(
        `SELECT ${NOTE_COLUMNS} FROM public.advisory_note n
          WHERE n.provider_id = $1::uuid AND n.deleted_at IS NULL
          ORDER BY n.updated_at DESC, n.id DESC LIMIT 100`,
        provider.id,
      );
      return ok({
        may_submit: (await activeApprovalOf(prisma, provider.id)) !== null,
        notes: rows.map(presentOwnNote),
      });
    },
  },

  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: advisoryNoteInputSchema,
    handler: async ({ auth, body: raw }) => {
      const body = raw as AdvisoryNoteInput;
      const owner = me(auth);
      const row = await audited(prisma, async (tx) => {
        const provider = await loadOwnProvider(tx, owner, true);
        if (!provider) throw unprocessable('advisory_note_not_approved');
        const applicationId = await activeApprovalOf(tx, provider.id);
        if (!applicationId) throw unprocessable('advisory_note_not_approved');

        const [inserted] = await tx.$queryRawUnsafe<NoteRow[]>(
          `INSERT INTO public.advisory_note
             (provider_id, application_id, auth_user_id, title, topics, language, body)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::text[], $6, $7)
           RETURNING ${NOTE_COLUMNS.replace(/n\./g, '')}`,
          provider.id,
          applicationId,
          owner,
          body.title,
          body.topics,
          body.language,
          body.body,
        );
        const note = inserted as NoteRow;
        await writeAudit(tx, {
          entityType: 'advisory_note',
          entityId: note.id,
          ...actorOf(auth),
          action: 'advisory_note.submitted',
          after: { status: 'submitted', provider_id: provider.id },
        });
        return note;
      });
      return created(presentOwnNote(row));
    },
  },
});
