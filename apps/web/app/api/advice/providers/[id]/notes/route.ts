import { PROVIDER_PUBLIC_WHERE } from '../../../../../../lib/api/advice';
import { APPROVAL_ACTIVE_SQL } from '../../../../../../lib/api/adviser-approval';
import {
  NOTE_COLUMNS,
  type NoteRow,
  presentPublicNote,
} from '../../../../../../lib/api/advisory-notes';
import { checkId } from '../../../../../../lib/api/market-posts';
import { defineRoutes, ok } from '../../../../../../lib/api/route';
import { prisma } from '../../../../../../lib/db';

/**
 * GET /api/advice/providers/:id/notes -- an approved adviser's PUBLISHED
 * official advisory notes, "Reviewed by CORWADO" (2026-10-28). Public,
 * read-only. Empty -- never an error -- for a provider that is not public, or
 * whose approval is revoked or suspended: the notes appear only beside the
 * badge. Title, topics, language, text and date; nothing about the review.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: 'public',
    handler: async ({ params }) => {
      const rows = await prisma.$queryRawUnsafe<NoteRow[]>(
        `SELECT ${NOTE_COLUMNS}
           FROM public.advisory_note n
           JOIN public.advice_provider p ON p.id = n.provider_id
          WHERE n.provider_id = $1::uuid AND n.status = 'published' AND n.deleted_at IS NULL
            AND ${PROVIDER_PUBLIC_WHERE} AND ${APPROVAL_ACTIVE_SQL}
          ORDER BY n.published_at DESC, n.id DESC
          LIMIT 50`,
        checkId(params.id),
      );
      return ok(rows.map(presentPublicNote));
    },
  },
});
