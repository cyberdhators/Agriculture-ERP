import {
  ADVICE_ATTACHMENT_BUCKET,
  ADVICE_ATTACHMENT_LIMITS,
  BUYER_ROLE,
  FARMER_ROLE,
  adviceAttachmentConfirmSchema,
  adviceAttachmentPath,
} from '@agri-erp/shared';

import {
  caseAttachments,
  loadCase,
  presentCase,
  type CaseRow,
} from '../../../../../../../lib/api/advice';
import { audited, writeAudit } from '../../../../../../../lib/api/audit';
import { conflict, unprocessable } from '../../../../../../../lib/api/errors';
import { checkId } from '../../../../../../../lib/api/market-posts';
import { actorOf, me } from '../../../../../../../lib/api/messaging';
import { defineRoutes, ok } from '../../../../../../../lib/api/route';
import { prisma } from '../../../../../../../lib/db';
import { describeStoredObject, removeStoredObject } from '../../../../../../../lib/supabase/admin';

/**
 * POST /api/advice/cases/:id/attachments/confirm -- the screen says the photo
 * is up; the server checks (2026-10-25). The object must EXIST at the path the
 * grant was for, and the provider's own facts -- not the phone's claim -- must
 * be the type declared and at most 2 MB. Anything else is removed and refused
 * (`advice_attachment_rejected`). Not there yet is 409
 * `advice_attachment_not_received`. A case that closed meanwhile, or that
 * already holds ten photos, refuses it and the object is removed.
 *
 * For the case's two participants only (404 for anyone else). The photo is
 * then shown to those two alone, as read links that expire. Audited as
 * `advice_attachment.added` with the case id, the type and the size -- never
 * the path. A retried confirm returns the case as it is.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: adviceAttachmentConfirmSchema,
    handler: async ({ auth, body, params }) => {
      const reader = me(auth);
      const id = checkId(params.id);
      const row = await loadCase(prisma, id, reader);
      const path = adviceAttachmentPath(row.id, body.upload_id, body.content_type);

      const [already] = await prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM public.advice_case_attachment
          WHERE id = $1::uuid AND case_id = $2::uuid AND storage_path = $3`,
        body.upload_id,
        row.id,
        path,
      );
      if (already) return ok(await presentCase(prisma, row, reader, true)); // a retried confirm

      const stored = await describeStoredObject(ADVICE_ATTACHMENT_BUCKET, path);
      if (!stored) throw conflict('advice_attachment_not_received');
      const type = (stored.contentType ?? '').toLowerCase().split(';')[0]?.trim();
      const discard = () => removeStoredObject(ADVICE_ATTACHMENT_BUCKET, path).catch(() => {});
      if (
        type !== body.content_type ||
        stored.byteSize === null ||
        stored.byteSize < 1 ||
        stored.byteSize > ADVICE_ATTACHMENT_LIMITS.maxBytes
      ) {
        await discard();
        throw unprocessable('advice_attachment_rejected');
      }
      const byteSize = stored.byteSize;

      let saved: CaseRow;
      try {
        saved = await audited(prisma, async (tx) => {
          const current = await loadCase(tx, id, reader, true);
          if (current.status === 'closed') throw unprocessable('advice_case_closed');
          const held = await caseAttachments(tx, current.id);
          if (held.length >= ADVICE_ATTACHMENT_LIMITS.perCase) {
            throw unprocessable('advice_attachment_limit_reached');
          }
          await tx.$executeRawUnsafe(
            `INSERT INTO public.advice_case_attachment
               (id, case_id, uploaded_by, storage_path, content_type, byte_size)
             VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6)`,
            body.upload_id,
            current.id,
            reader,
            path,
            body.content_type,
            byteSize,
          );
          await writeAudit(tx, {
            entityType: 'advice_case_attachment',
            entityId: body.upload_id,
            ...actorOf(auth),
            action: 'advice_attachment.added',
            after: {
              case_id: current.id,
              content_type: body.content_type,
              byte_size: byteSize,
              by_side: current.requester_auth_user_id === reader ? 'requester' : 'provider',
            },
          });
          return loadCase(tx, current.id, reader);
        });
      } catch (e) {
        // Another confirm of the same upload may have won the race: then the
        // photo is saved and this is that request again.
        const [raced] = await prisma.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM public.advice_case_attachment WHERE id = $1::uuid AND storage_path = $2`,
          body.upload_id,
          path,
        );
        if (raced) return ok(await presentCase(prisma, row, reader, true));
        // Refused after the check: nothing points at the object, so it goes.
        await discard();
        throw e;
      }
      return ok(await presentCase(prisma, saved, reader, true));
    },
  },
});
