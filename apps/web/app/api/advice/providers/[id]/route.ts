import {
  PROVIDER_COLUMNS,
  PROVIDER_PUBLIC_WHERE,
  presentProvider,
  type ProviderRow,
} from '../../../../../lib/api/advice';
import { notFound } from '../../../../../lib/api/errors';
import { checkId } from '../../../../../lib/api/market-posts';
import { defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * GET /api/advice/providers/:id -- one published advice profile (2026-10-22):
 * topics, languages, states covered, delivery, availability, free or paid
 * terms and any commercial interests, as the provider wrote them. A draft or
 * unpublished profile, or one whose account is deleted or suspended, is 404
 * like a missing one. Same whitelist as the directory. Public, read-only.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: 'public',
    handler: async ({ params }) => {
      const [row] = await prisma.$queryRawUnsafe<ProviderRow[]>(
        `SELECT ${PROVIDER_COLUMNS} FROM public.advice_provider p
          WHERE p.id = $1::uuid AND ${PROVIDER_PUBLIC_WHERE}`,
        checkId(params.id),
      );
      if (!row) throw notFound();
      return ok(presentProvider(row));
    },
  },
});
