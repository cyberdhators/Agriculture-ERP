import { buyerRegistrationSchema, initialStanding } from '@agri-erp/shared';

import { audited, writeAudit, writeAuditOutcome } from '../../../../lib/api/audit';
import { authUnavailable, conflict, unprocessable } from '../../../../lib/api/errors';
import { created, defineRoutes } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';
import {
  AuthUnavailableError,
  createAuthAccount,
  deleteAuthAccount,
} from '../../../../lib/supabase/admin';

/**
 * POST /api/buyer/register -- a buyer organisation applies for an account.
 * B13, C-14B.1 and C-14B.2.
 *
 * PUBLIC, BECAUSE THE APPLICANT HAS NO ACCOUNT YET. Self-registration stays
 * disabled on the authentication service (C-3.1): this route creates the
 * account server-side, so the one door a stranger can open is this one, and
 * it opens onto an account whose reach depends on its kind (owner, 2026-10-06):
 *
 *   - an INDIVIDUAL buyer needs no review. Their standing is `not_required` --
 *     never `verified`, because nobody checked them -- and they may browse and
 *     send requests at once. An administrator can still suspend or reject one.
 *   - a BUSINESS is `pending`: it can browse and save drafts, and sends no
 *     purchase request until an administrator verifies it (C-14B.3).
 *
 * The applicant chooses their kind, and nothing else about their standing --
 * the body is strict, and `verification_status` is not a field it can carry.
 * That a business may call itself an individual to skip review is the cost
 * of the owner's decision, recorded in docs/DECISIONS.md, not an oversight.
 *
 * WHAT IS KNOWINGLY UNCLOSED, stated rather than discovered:
 *
 *   - There is no rate-limiting infrastructure in this system (see the product
 *     report route, which says the same). A script can create many pending
 *     accounts. They are inert until reviewed and the review queue shows them,
 *     but they cost an administrator's time and an auth account each.
 *   - An address that is already registered answers 409, which tells the
 *     caller that the address has an account. The staff route does the same,
 *     behind an administrator; here it is public. Accepted for now because a
 *     sign-up that silently "succeeds" leaves a real buyer unable to sign in
 *     with no explanation. Revisit with the rate limiter.
 *   - The address is not proven to belong to the applicant: the account is
 *     created confirmed, as staff accounts are, because there is no mail
 *     verification flow. The administrator's review is the check.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: 'public',
    bodySchema: buyerRegistrationSchema,
    handler: async ({ body }) => {
      // Locations are checked before any account exists, so a typo costs the
      // applicant a 422 and costs the system nothing to undo.
      if (body.state_id) {
        const [state] = await prisma.$queryRawUnsafe<{ id: string }[]>(
          'SELECT id FROM public.state_active WHERE id = $1',
          body.state_id,
        );
        if (!state) throw unprocessable('state_not_found');
      }
      if (body.county_id) {
        const [county] = await prisma.$queryRawUnsafe<{ id: string }[]>(
          'SELECT id FROM public.county_active WHERE id = $1 AND state_id = $2',
          body.county_id,
          body.state_id,
        );
        if (!county) throw unprocessable('county_not_found');
      }
      if (body.preferred_state_ids.length > 0) {
        const found = await prisma.$queryRawUnsafe<{ id: string }[]>(
          'SELECT id FROM public.state_active WHERE id = ANY($1::text[])',
          body.preferred_state_ids,
        );
        if (found.length !== body.preferred_state_ids.length)
          throw unprocessable('state_not_found');
      }

      let authUserId: string;
      try {
        authUserId = await createAuthAccount(body.email, body.password);
      } catch (failure) {
        if (failure instanceof AuthUnavailableError) throw authUnavailable();
        throw conflict('account_already_exists');
      }

      const standing = initialStanding(body.account_type);
      // An individual's account carries their own name; a business's, its own.
      const accountName =
        body.account_type === 'individual'
          ? (body.organization_name ?? `${body.given_name} ${body.family_name}`)
          : body.organization_name!;
      const accountKind = body.organization_type ?? 'other';

      try {
        const result = await audited(prisma, async (tx) => {
          const [organization] = await tx.$queryRawUnsafe<{ id: string }[]>(
            `INSERT INTO public.buyer_organization
               (name, organization_type, registration_number, tax_id, country_code, state_id,
                county_id, city, address, website, description, interested_categories,
                interested_products, preferred_state_ids, min_quantity, max_quantity,
                preferred_unit, delivery_locations, purchasing_months, payment_preferences,
                account_type, verification_status)
             VALUES ($1, $2::public.buyer_organization_type, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                     $12::public.listing_category[], $13::text[], $14::text[], $15, $16,
                     $17::public.listing_unit, $18::text[], $19::smallint[],
                     $20::public.buyer_payment_preference[],
                     $21::public.buyer_account_type, $22::public.buyer_verification_status)
             RETURNING id`,
            accountName,
            accountKind,
            body.registration_number ?? null,
            body.tax_id ?? null,
            body.country_code,
            body.state_id ?? null,
            body.county_id ?? null,
            body.city ?? null,
            body.address ?? null,
            body.website ?? null,
            body.description ?? null,
            body.interested_categories,
            body.interested_products,
            body.preferred_state_ids,
            body.min_quantity ?? null,
            body.max_quantity ?? null,
            body.preferred_unit ?? null,
            body.delivery_locations,
            body.purchasing_months,
            body.payment_preferences,
            body.account_type,
            standing,
          );
          const [buyer] = await tx.$queryRawUnsafe<{ id: string }[]>(
            `INSERT INTO public.buyer (auth_user_id, organization_id, given_name, family_name, phone)
             VALUES ($1::uuid, $2::uuid, $3, $4, $5) RETURNING id`,
            authUserId,
            organization!.id,
            body.given_name,
            body.family_name,
            body.phone,
          );
          await writeAudit(tx, {
            entityType: 'buyer_organization',
            entityId: organization!.id,
            actorType: 'buyer',
            actorId: buyer!.id,
            action: 'buyer.registered',
            // No names, address, phone, email, registration or tax number:
            // auditSafe strips those by key, and they are not passed anyway.
            after: {
              buyer_id: buyer!.id,
              account_type: body.account_type,
              organization_type: accountKind,
              country_code: body.country_code,
              state_id: body.state_id ?? null,
              verification_status: standing,
            },
          });
          return { buyerId: buyer!.id, organizationId: organization!.id };
        });

        return created({
          id: result.buyerId,
          organization_id: result.organizationId,
          account_type: body.account_type,
          verification_status: standing,
        });
      } catch (failure) {
        // Compensate, exactly as the staff route does: an auth account with no
        // buyer row fails closed at requireRole, and if removing it fails too,
        // the outcome is recorded rather than assumed.
        const compensated = await deleteAuthAccount(authUserId)
          .then(() => true)
          .catch(() => false);
        if (!compensated) {
          await writeAuditOutcome({
            entityType: 'auth_account',
            entityId: authUserId,
            actorType: 'system',
            actorId: null,
            action: 'auth.account_orphaned',
          }).catch(() => undefined);
        }
        throw failure;
      }
    },
  },
});
