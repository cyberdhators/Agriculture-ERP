import { randomUUID } from 'node:crypto';

import {
  ADVICE_ATTACHMENT_BUCKET,
  ADVICE_ATTACHMENT_LIMITS,
  BUYER_ROLE,
  FARMER_ROLE,
  adviceAttachmentPath,
  adviceAttachmentUploadSchema,
} from '@agri-erp/shared';

import { caseAttachments, loadCase } from '../../../../../../../lib/api/advice';
import { unprocessable } from '../../../../../../../lib/api/errors';
import { checkId } from '../../../../../../../lib/api/market-posts';
import { me } from '../../../../../../../lib/api/messaging';
import { defineRoutes, ok } from '../../../../../../../lib/api/route';
import { prisma } from '../../../../../../../lib/db';
import { issueUploadGrant } from '../../../../../../../lib/supabase/admin';

/**
 * POST /api/advice/cases/:id/attachments/upload-url -- a signed upload grant
 * for one photo on an advice case (2026-10-25). Either of the case's two
 * participants may ask, while the case is open or in progress; anyone else
 * gets 404 (loadCase), so a case's existence is not told.
 *
 * The visit-attachment mechanism, reused as profile photos do: bytes never
 * pass through a route. The type and size are judged by the shared schema
 * before any byte travels; the private bucket enforces the same ceiling and
 * types at upload; confirm checks what arrived. The path is the case's id and
 * a fresh upload id, so a grant can never overwrite a photo already there.
 *
 * Writes nothing to the database, so nothing to audit: the photo joins the
 * case only at confirm, which is audited.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: adviceAttachmentUploadSchema,
    handler: async ({ auth, body, params }) => {
      const row = await loadCase(prisma, checkId(params.id), me(auth));
      if (row.status === 'closed') throw unprocessable('advice_case_closed');
      const held = await caseAttachments(prisma, row.id);
      if (held.length >= ADVICE_ATTACHMENT_LIMITS.perCase) {
        throw unprocessable('advice_attachment_limit_reached');
      }
      const uploadId = randomUUID();
      const grant = await issueUploadGrant(
        ADVICE_ATTACHMENT_BUCKET,
        adviceAttachmentPath(row.id, uploadId, body.content_type),
      );
      return ok({ upload_id: uploadId, url: grant.url, token: grant.token });
    },
  },
});
