import { LEARNING_READ_LINK_SECONDS, LEARNING_RESOURCE_BUCKET, toIso } from '@agri-erp/shared';

import { conflict, notFound } from '../../../../../lib/api/errors';
import { PUBLIC_GUIDE_FROM, PUBLIC_GUIDE_WHERE } from '../../../../../lib/api/learning';
import { checkId } from '../../../../../lib/api/market-posts';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';
import { issueReadLink } from '../../../../../lib/supabase/admin';

/**
 * GET /api/guides/:id/file -- a read link to a PUBLISHED guide's file, for
 * anyone (2026-10-22). The media of a guide is the file the library already
 * registers (storage_path and byte_size, migration 6); this serves it through
 * the same mechanism as a visit attachment (issueReadLink, C-8.8): a private
 * bucket, a link issued per request that expires in minutes, the path never
 * shown.
 *
 * NOT AUDITED, unlike the visit attachment link. That one is audited because
 * it opens a farmer's photograph; this opens text CORWADO chose to publish,
 * and a visitor has no identity to record.
 *
 * Not published is the house 404. A published guide whose object is not in
 * the bucket (or the bucket is not there yet) is `guide_file_unavailable`,
 * never the provider's own error.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: 'public',
    handler: async ({ params }) => {
      const [row] = await prisma.$queryRawUnsafe<
        { id: string; storage_path: string; format: string }[]
      >(
        `SELECT id, storage_path, format::text AS format ${PUBLIC_GUIDE_FROM}
          WHERE id = $1::uuid AND ${PUBLIC_GUIDE_WHERE}`,
        checkId(params.id),
      );
      if (!row) throw notFound();
      let link: { url: string; expiresAt: Date };
      try {
        link = await issueReadLink(
          LEARNING_RESOURCE_BUCKET,
          row.storage_path,
          LEARNING_READ_LINK_SECONDS,
        );
      } catch {
        throw conflict('guide_file_unavailable');
      }
      return ok({
        guide_id: row.id,
        format: row.format,
        url: link.url,
        expires_at: toIso(link.expiresAt),
      });
    },
  },
});
