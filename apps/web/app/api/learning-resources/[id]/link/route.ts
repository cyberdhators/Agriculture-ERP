import { LEARNING_LIMITS, LEARNING_RESOURCE_BUCKET, toIso } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { notFound } from '../../../../../lib/api/errors';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';
import { issueReadLink } from '../../../../../lib/supabase/admin';

/**
 * GET /api/learning-resources/:id/link — a read link for one resource,
 * granted per request and expiring in minutes.
 *
 * THE BUCKET IS PRIVATE AND THE PATH IS NEVER THE ACCESS MECHANISM. A row
 * carries `storage_path`, but a path is not an address: the object can only be
 * reached through a signed link the server issues, and the server reads the
 * path from the row it just loaded. The client sends an id and nothing else,
 * so it cannot name a bucket, name a path, or point this at another object.
 *
 * VISIBILITY IS THE LIST'S RULE, NOT A SECOND ONE. `GET /api/learning-resources`
 * adds `published = true` for any caller whose scope is not `all`; this applies
 * exactly the same predicate, from the same place, so what an officer can open
 * is precisely what they can see. An unpublished resource is NOT FOUND to them
 * -- not forbidden -- so probing ids tells them nothing about what exists.
 *
 * THE READ IS AUDITED, the one read of a learning resource that is. A link
 * outlives the request and can be copied or forwarded, so who asked, for what,
 * when is recorded — never the link. The row is written before the link is
 * issued: an audit row without a link is a request that failed; a link without
 * an audit row would be an access nobody can account for. Listing the
 * catalogue is not audited, because a list is metadata and a link is access.
 */
interface Row {
  id: string;
  title: string;
  format: string;
  storage_path: string;
  published: boolean;
}

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only', 'officer'],
    handler: async ({ auth, params }) => {
      const id = params.id ?? '';
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        throw notFound();
      }

      // The same predicate the list uses, applied in the WHERE so an
      // unpublished row is never read rather than read and then refused.
      const where = ['id = $1::uuid'];
      if (auth.scope.kind !== 'all') where.push('published = true');
      const [row] = await prisma.$queryRawUnsafe<Row[]>(
        `SELECT id, title, format::text AS format, storage_path, published
         FROM public.learning_resource_active WHERE ${where.join(' AND ')}`,
        id,
      );
      if (!row) throw notFound();

      await audited(prisma, (tx) =>
        writeAudit(tx, {
          entityType: 'learning_resource',
          entityId: row.id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'learning_resource.link_issued',
          after: {
            resource_id: row.id,
            format: row.format,
            expires_in_seconds: LEARNING_LIMITS.readLinkSeconds,
          },
        }),
      );

      const link = await issueReadLink(
        LEARNING_RESOURCE_BUCKET,
        row.storage_path,
        LEARNING_LIMITS.readLinkSeconds,
      );
      return ok({
        resource_id: row.id,
        title: row.title,
        format: row.format,
        url: link.url,
        expires_at: toIso(link.expiresAt),
      });
    },
  },
});
