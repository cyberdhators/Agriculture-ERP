import {
  BUYER_MESSAGES,
  BUYER_VERIFICATION_STATUSES,
  DEFAULT_LIMIT,
  ERROR_CODES,
  ERROR_MESSAGES,
  MAX_LIMIT,
  buyerListFilterSchema,
  decodeCursor,
  encodeCursor,
  zodErrorToApiError,
} from '@agri-erp/shared';

import { ApiFailure, invalidCursor } from '../../../../lib/api/errors';
import { defineRoutes, paged } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';
import { adminAuthEmails } from '../../../../lib/supabase/admin';

/**
 * GET /api/admin/buyers -- the buyer review queue. Administrator only. B13,
 * C-14B.3.
 *
 * Oldest first within a status, so the organisation that has waited longest
 * is reviewed first. An administrator sees the applicant's contact details,
 * because verifying an organisation means contacting it; nobody else does.
 */
interface OrgRow {
  id: string;
  account_type: string;
  name: string;
  organization_type: string;
  registration_number: string | null;
  tax_id: string | null;
  country_code: string;
  state_id: string | null;
  city: string | null;
  website: string | null;
  description: string | null;
  verification_status: string;
  verification_note: string | null;
  verified_at: Date | null;
  created_at: Date;
  contact_name: string | null;
  contact_phone: string | null;
  contact_auth_user_id: string | null;
  open_requests: number;
}

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin'],
    handler: async ({ request }) => {
      const parsed = buyerListFilterSchema.safeParse(
        Object.fromEntries(new URL(request.url).searchParams),
      );
      if (!parsed.success) {
        const { body } = zodErrorToApiError(parsed.error);
        throw new ApiFailure(400, body.error.code, body.error.message, body.error.fields);
      }
      const filter = parsed.data;
      let limit = DEFAULT_LIMIT;
      if (filter.limit !== undefined) {
        const n = Number(filter.limit);
        if (!Number.isInteger(n) || n < 1) throw invalidCursor();
        limit = Math.min(n, MAX_LIMIT);
      }
      const params: unknown[] = [];
      const where = ['o.deleted_at IS NULL'];
      if (filter.status) {
        if (!(BUYER_VERIFICATION_STATUSES as readonly string[]).includes(filter.status)) {
          throw new ApiFailure(400, ERROR_CODES.invalidInput, ERROR_MESSAGES.invalidInput, {
            status: BUYER_MESSAGES.statusFilterUnknown,
          });
        }
        params.push(filter.status);
        where.push(`o.verification_status = $${params.length}::public.buyer_verification_status`);
      }
      if (filter.cursor !== undefined) {
        const cursor = decodeCursor(filter.cursor);
        if (!cursor) throw invalidCursor();
        params.push(cursor.createdAt, cursor.id);
        where.push(
          `(o.created_at, o.id) > ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
        );
      }
      const rows = await prisma.$queryRawUnsafe<OrgRow[]>(
        `SELECT o.id, o.account_type::text AS account_type, o.name,
                o.organization_type::text AS organization_type,
                o.registration_number, o.tax_id, o.country_code, o.state_id, o.city, o.website,
                o.description, o.verification_status::text AS verification_status,
                o.verification_note, o.verified_at, o.created_at,
                c.given_name || ' ' || c.family_name AS contact_name, c.phone AS contact_phone,
                c.auth_user_id AS contact_auth_user_id,
                (SELECT count(*)::int FROM public.purchase_request r
                  WHERE r.organization_id = o.id AND r.deleted_at IS NULL
                    AND r.status IN ('submitted','under_review')) AS open_requests
           FROM public.buyer_organization o
           LEFT JOIN LATERAL (
             SELECT b.given_name, b.family_name, b.phone, b.auth_user_id
               FROM public.buyer_active b WHERE b.organization_id = o.id
              ORDER BY b.created_at ASC LIMIT 1
           ) c ON true
          WHERE ${where.join(' AND ')}
          ORDER BY o.created_at ASC, o.id ASC
          LIMIT ${limit + 1}`,
        ...params,
      );
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const emails = await adminAuthEmails(
        page.flatMap((r) => (r.contact_auth_user_id ? [r.contact_auth_user_id] : [])),
      ).catch(() => new Map<string, string>());
      const last = page[page.length - 1];
      return paged(
        page.map((r) => ({
          id: r.id,
          account_type: r.account_type,
          name: r.name,
          organization_type: r.organization_type,
          registration_number: r.registration_number,
          tax_id: r.tax_id,
          country_code: r.country_code,
          state_id: r.state_id,
          city: r.city,
          website: r.website,
          description: r.description,
          verification_status: r.verification_status,
          verification_note: r.verification_note,
          verified_at: r.verified_at?.toISOString() ?? null,
          created_at: r.created_at.toISOString(),
          contact: {
            name: r.contact_name,
            phone: r.contact_phone,
            email: r.contact_auth_user_id ? (emails.get(r.contact_auth_user_id) ?? null) : null,
          },
          open_requests: r.open_requests,
        })),
        {
          cursor:
            hasMore && last
              ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id })
              : null,
          hasMore,
        },
      );
    },
  },
});
