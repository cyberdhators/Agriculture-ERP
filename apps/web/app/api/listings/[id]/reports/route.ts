import { createHash } from 'node:crypto';

import { submitProductReportSchema } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../../lib/api/audit';
import { ApiFailure, notFound } from '../../../../../lib/api/errors';
import { created, defineRoutes } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * POST /api/listings/:id/reports — a marketplace visitor reports a listing.
 *
 * THE SECOND UNAUTHENTICATED WRITE IN THIS SYSTEM, and the more careful of the
 * two. A buyer holds no account (DECISIONS, 2026-09-09), so requiring a
 * session would mean nobody could report anything.
 *
 * WHAT IS STORED ABOUT THE PERSON: NOTHING. No name, no phone, no address is
 * asked for or accepted — the schema is strict, so a body carrying one is
 * refused outright. `submission_digest` is a ONE-WAY hash of the submitting
 * connection combined with the listing, kept for a single purpose: refusing a
 * second report of the same listing from the same source. It identifies
 * nobody, cannot be reversed into an address, is never returned by any route,
 * and is not written into an audit row.
 *
 * WHAT THIS ROUTE DOES NOT DO: RATE LIMITING. There is no rate-limiting
 * infrastructure anywhere in this application -- no limiter, no counter table,
 * no edge rule, nothing in `middleware.ts` -- and the digest is NOT one. The
 * digest refuses a second report of the SAME listing from the SAME source; it
 * does nothing about a thousand reports of a thousand listings, and a source
 * that varies `x-forwarded-for` defeats it in one line of script. So this
 * endpoint can be flooded, and saying otherwise would be worse than the gap.
 * Adding a real limiter means a shared store this project does not have (a
 * counter table, or a paid edge service), which is a dependency decision and
 * an architecture change -- CLAUDE.md section 5, a human's call, not a
 * session's. It is named as outstanding in
 * docs/api/product-reports-contract.md, and it is the same question the
 * contact-request contract has been waiting on.
 *
 * AN UNKNOWN LISTING IS 404, NOT A REFUSAL. The platform rule holds even for a
 * stranger: a record outside what the caller may see is indistinguishable from
 * one that does not exist, so a removed listing and a fictional one answer
 * identically and neither confirms anything.
 */
/** The shape of an id, checked before the database is asked (lib/api/farmers.ts). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: 'public',
    bodySchema: submitProductReportSchema,
    handler: async ({ body, params, request }) => {
      const listingId = params.id ?? '';
      // A malformed id is answered as a missing one, and the driver is never
      // given the chance to produce a sentence about types or tables. The same
      // guard opens loadVisible in farmers, farms and visits; it was missing
      // here, which made `/api/listings/not-a-uuid/reports` a 500 where every
      // other id answers 404.
      if (!UUID.test(listingId)) throw notFound();

      const [listing] = await prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM public.produce_listing_active WHERE id = $1::uuid AND status = 'listed'`,
        listingId,
      );
      if (!listing) throw notFound();

      // A weak, deliberate signal. `x-forwarded-for` is trivially spoofed, so
      // this is a courtesy against double-submission rather than a security
      // control, and it is hashed with the listing so the same person reporting
      // two different listings is two different digests.
      const source = request.headers.get('x-forwarded-for') ?? 'unknown';
      const digest = createHash('sha256').update(`${source}:${listing.id}`).digest('hex');

      const [existing] = await prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM public.product_report_active
          WHERE listing_id = $1::uuid AND submission_digest = $2 LIMIT 1`,
        listing.id,
        digest,
      );
      if (existing) {
        throw new ApiFailure(
          409,
          'report_already_submitted',
          'This listing has already been reported from here. It is with the programme team.',
        );
      }

      const report = await audited(prisma, async (tx) => {
        const [row] = await tx.$queryRawUnsafe<{ id: string; status: string }[]>(
          `INSERT INTO public.product_report (listing_id, reason, description, submission_digest)
           VALUES ($1::uuid, $2::public.report_reason, $3, $4)
           RETURNING id, status::text AS status`,
          listing.id,
          body.reason,
          body.description ?? null,
          digest,
        );
        if (!row) throw new ApiFailure(500, 'empty', 'The report could not be recorded.');

        await writeAudit(tx, {
          entityType: 'product_report',
          entityId: row.id,
          // No person took this action in the sense the log means: there is no
          // account behind it. `system` is the actor type the audit enum has
          // for an act with no principal.
          actorType: 'system',
          actorId: null,
          action: 'product_report.created',
          // The reason is a fixed code. The description is NOT recorded here:
          // it is free text a stranger wrote and may name somebody (C-4.7).
          after: { listing_id: listing.id, reason: body.reason, status: row.status },
        });
        return row;
      });

      // The submitter learns that it was received and nothing else — no report
      // id to enumerate with, no status to poll, no listing state.
      return created({ received: true, id: report.id });
    },
  },
});
