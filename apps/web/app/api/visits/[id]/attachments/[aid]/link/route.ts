import { ATTACHMENT_LIMITS, VISIT_ATTACHMENT_BUCKET, toIso } from '@agri-erp/shared';
import { conflict } from '../../../../../../../lib/api/errors';
import { defineRoutes, ok } from '../../../../../../../lib/api/route';
import { loadAttachment, loadVisibleVisit } from '../../../../../../../lib/api/visits';
import { prisma } from '../../../../../../../lib/db';
import { issueReadLink } from '../../../../../../../lib/supabase/admin';

/**
 * GET /api/visits/:id/attachments/:aid/link — a read link for an arrived
 * attachment, granted per request and expiring in minutes (C-8.8). Scope is
 * the visit's: outside it, the visit is not found, so neither is the file.
 * A waiting or failed attachment has nothing to open.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only', 'officer'],
    handler: async ({ auth, params }) => {
      const visit = await loadVisibleVisit(prisma, params.id ?? '', auth);
      const attachment = await loadAttachment(prisma, visit.id, params.aid ?? '');
      if (attachment.status !== 'arrived') throw conflict('attachment_not_received');
      const link = await issueReadLink(
        VISIT_ATTACHMENT_BUCKET,
        attachment.storage_path,
        ATTACHMENT_LIMITS.readLinkSeconds,
      );
      return ok({
        attachment_id: attachment.id,
        content_type: attachment.content_type,
        url: link.url,
        expires_at: toIso(link.expiresAt),
      });
    },
  },
});
