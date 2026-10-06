import {
  BUYER_MESSAGES,
  BUYER_PERSON_FIELDS,
  BUYER_ROLE,
  ERROR_CODES,
  ERROR_MESSAGES,
  buyerCapabilities,
  buyerProfilePatchSchema,
  toIso,
} from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import { buyerActor } from '../../../../lib/api/buyers';
import { ApiFailure, unprocessable } from '../../../../lib/api/errors';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { buyerScope } from '../../../../lib/api/scope';
import { prisma } from '../../../../lib/db';
import { adminAuthEmails } from '../../../../lib/supabase/admin';

/**
 * GET and PATCH /api/buyer/profile -- the signed-in buyer, and their
 * organisation. B13, C-14B.5 and C-14B.14.
 *
 * THERE IS NO ID IN THIS ADDRESS, and that is the authorization. Both rows are
 * found from the session: a buyer cannot name another buyer or another
 * organisation here, so there is no identifier to tamper with (C-14B.22).
 *
 * Standing is read-only to a buyer. `verification_status` and its note are
 * returned and never accepted -- the patch schema is strict and has no such
 * field, so sending one is a 400 that names it.
 */

interface ProfileRow {
  buyer_id: string;
  auth_user_id: string;
  given_name: string;
  family_name: string;
  phone: string;
  organization_id: string;
  account_type: 'individual' | 'business';
  organization_name: string;
  organization_type: string;
  registration_number: string | null;
  tax_id: string | null;
  country_code: string;
  state_id: string | null;
  county_id: string | null;
  city: string | null;
  address: string | null;
  website: string | null;
  description: string | null;
  interested_categories: string[];
  interested_products: string[];
  preferred_state_ids: string[];
  min_quantity: string | null;
  max_quantity: string | null;
  preferred_unit: string | null;
  delivery_locations: string[];
  purchasing_months: number[];
  payment_preferences: string[];
  verification_status:
    'pending' | 'under_review' | 'verified' | 'rejected' | 'suspended' | 'not_required';
  verification_note: string | null;
  verified_at: Date | null;
  created_at: Date;
}

async function loadProfile(buyerId: string): Promise<ProfileRow> {
  const [row] = await prisma.$queryRawUnsafe<ProfileRow[]>(
    `SELECT b.id AS buyer_id, b.auth_user_id, b.given_name, b.family_name, b.phone,
            o.id AS organization_id, o.account_type::text AS account_type,
            o.name AS organization_name,
            o.organization_type::text AS organization_type, o.registration_number, o.tax_id,
            o.country_code, o.state_id, o.county_id, o.city, o.address, o.website, o.description,
            o.interested_categories::text[] AS interested_categories, o.interested_products,
            o.preferred_state_ids, o.min_quantity::text AS min_quantity,
            o.max_quantity::text AS max_quantity, o.preferred_unit::text AS preferred_unit,
            o.delivery_locations, o.purchasing_months::int[] AS purchasing_months,
            o.payment_preferences::text[] AS payment_preferences,
            o.verification_status::text AS verification_status, o.verification_note,
            o.verified_at, o.created_at
       FROM public.buyer_active b
       JOIN public.buyer_organization_active o ON o.id = b.organization_id
      WHERE b.id = $1::uuid`,
    buyerId,
  );
  // requireRole found this buyer a moment ago through the same views.
  if (!row) throw new Error('buyer row vanished between requireRole and the profile read');
  return row;
}

async function present(row: ProfileRow) {
  // The address lives in the authentication store only, as for staff. A
  // failure to read it is not a failure to read the profile.
  const emails = await adminAuthEmails([row.auth_user_id]).catch(() => new Map<string, string>());
  return {
    person: {
      id: row.buyer_id,
      given_name: row.given_name,
      family_name: row.family_name,
      email: emails.get(row.auth_user_id) ?? null,
      phone: row.phone,
    },
    organization: {
      id: row.organization_id,
      // Read-only: changing kind would change whether review applies.
      account_type: row.account_type,
      name: row.organization_name,
      organization_type: row.organization_type,
      registration_number: row.registration_number,
      tax_id: row.tax_id,
      country_code: row.country_code,
      state_id: row.state_id,
      county_id: row.county_id,
      city: row.city,
      address: row.address,
      website: row.website,
      description: row.description,
      created_at: toIso(row.created_at),
    },
    procurement: {
      interested_categories: row.interested_categories,
      interested_products: row.interested_products,
      preferred_state_ids: row.preferred_state_ids,
      min_quantity: row.min_quantity === null ? null : Number(row.min_quantity),
      max_quantity: row.max_quantity === null ? null : Number(row.max_quantity),
      preferred_unit: row.preferred_unit,
      delivery_locations: row.delivery_locations,
      purchasing_months: row.purchasing_months,
      payment_preferences: row.payment_preferences,
    },
    verification: {
      status: row.verification_status,
      note: row.verification_note,
      verified_at: row.verified_at ? toIso(row.verified_at) : null,
      capabilities: buyerCapabilities(row.verification_status),
    },
  };
}

/** Column name in buyer_organization for each organisation field of the patch. */
const ORG_COLUMNS: Record<string, { column: string; cast?: string }> = {
  organization_name: { column: 'name' },
  organization_type: { column: 'organization_type', cast: 'public.buyer_organization_type' },
  registration_number: { column: 'registration_number' },
  tax_id: { column: 'tax_id' },
  country_code: { column: 'country_code' },
  state_id: { column: 'state_id' },
  county_id: { column: 'county_id' },
  city: { column: 'city' },
  address: { column: 'address' },
  website: { column: 'website' },
  description: { column: 'description' },
  interested_categories: { column: 'interested_categories', cast: 'public.listing_category[]' },
  interested_products: { column: 'interested_products', cast: 'text[]' },
  preferred_state_ids: { column: 'preferred_state_ids', cast: 'text[]' },
  min_quantity: { column: 'min_quantity', cast: 'numeric' },
  max_quantity: { column: 'max_quantity', cast: 'numeric' },
  preferred_unit: { column: 'preferred_unit', cast: 'public.listing_unit' },
  delivery_locations: { column: 'delivery_locations', cast: 'text[]' },
  purchasing_months: { column: 'purchasing_months', cast: 'smallint[]' },
  payment_preferences: { column: 'payment_preferences', cast: 'public.buyer_payment_preference[]' },
};

const PERSON_COLUMNS = new Set<string>(BUYER_PERSON_FIELDS);

/**
 * A cross-field rule that only the stored row can decide -- the patch alone
 * was valid. Reported exactly as the schema would have reported it.
 */
const fieldError = (field: string, reason: string) =>
  new ApiFailure(400, ERROR_CODES.invalidInput, ERROR_MESSAGES.invalidInput, { [field]: reason });

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [BUYER_ROLE],
    handler: async ({ auth }) => {
      const scope = buyerScope(auth);
      return ok(await present(await loadProfile(scope.buyerId)));
    },
  },

  PATCH: {
    roles: [BUYER_ROLE],
    bodySchema: buyerProfilePatchSchema,
    handler: async ({ auth, body }) => {
      const scope = buyerScope(auth);
      const current = await loadProfile(scope.buyerId);

      // The state and county are judged as the row WILL be, so a patch that
      // changes only the county is checked against the state already stored.
      const stateId = body.state_id !== undefined ? body.state_id : current.state_id;
      const countyId = body.county_id !== undefined ? body.county_id : current.county_id;
      if (countyId && !stateId) throw fieldError('county_id', BUYER_MESSAGES.countyNeedsState);
      if (body.state_id) {
        const [state] = await prisma.$queryRawUnsafe<{ id: string }[]>(
          'SELECT id FROM public.state_active WHERE id = $1',
          body.state_id,
        );
        if (!state) throw unprocessable('state_not_found');
      }
      if (countyId && (body.state_id !== undefined || body.county_id !== undefined)) {
        const [county] = await prisma.$queryRawUnsafe<{ id: string }[]>(
          'SELECT id FROM public.county_active WHERE id = $1 AND state_id = $2',
          countyId,
          stateId,
        );
        if (!county) throw unprocessable('county_not_found');
      }
      if (body.preferred_state_ids && body.preferred_state_ids.length > 0) {
        const found = await prisma.$queryRawUnsafe<{ id: string }[]>(
          'SELECT id FROM public.state_active WHERE id = ANY($1::text[])',
          body.preferred_state_ids,
        );
        if (found.length !== body.preferred_state_ids.length)
          throw unprocessable('state_not_found');
      }
      // The quantity range is judged as the row will be, as the database will.
      const min = body.min_quantity !== undefined ? body.min_quantity : current.min_quantity;
      const max = body.max_quantity !== undefined ? body.max_quantity : current.max_quantity;
      if (min !== null && max !== null && Number(max) < Number(min)) {
        throw fieldError('max_quantity', BUYER_MESSAGES.quantityRangeInverted);
      }

      const personSets: string[] = [];
      const personParams: unknown[] = [];
      const orgSets: string[] = [];
      const orgParams: unknown[] = [];
      const personChanged: string[] = [];
      const orgChanged: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(body)) {
        if (value === undefined) continue;
        if (PERSON_COLUMNS.has(key)) {
          personParams.push(value);
          personSets.push(`${key} = $${personParams.length}`);
          personChanged.push(key);
          continue;
        }
        const target = ORG_COLUMNS[key];
        if (!target) continue; // unreachable: the schema is strict
        orgParams.push(value);
        orgSets.push(
          `${target.column} = $${orgParams.length}${target.cast ? `::${target.cast}` : ''}`,
        );
        orgChanged[key] = value;
      }

      await audited(prisma, async (tx) => {
        if (personSets.length > 0) {
          personParams.push(scope.buyerId);
          await tx.$executeRawUnsafe(
            `UPDATE public.buyer SET ${personSets.join(', ')}, updated_at = now()
              WHERE id = $${personParams.length}::uuid`,
            ...personParams,
          );
          await writeAudit(tx, {
            entityType: 'buyer',
            entityId: scope.buyerId,
            ...buyerActor(auth),
            action: 'buyer.updated',
            // Which fields changed, never their values: every person field is
            // a name or a phone, and none of those enter the log (C-14B.21).
            after: { changed: personChanged },
          });
        }
        if (orgSets.length > 0) {
          orgParams.push(scope.organizationId);
          await tx.$executeRawUnsafe(
            `UPDATE public.buyer_organization SET ${orgSets.join(', ')}, updated_at = now()
              WHERE id = $${orgParams.length}::uuid`,
            ...orgParams,
          );
          await writeAudit(tx, {
            entityType: 'buyer_organization',
            entityId: scope.organizationId,
            ...buyerActor(auth),
            action: 'buyer_organization.updated',
            // Changed fields with their new values; auditSafe drops the
            // registration and tax numbers by key.
            after: orgChanged,
          });
        }
      });

      return ok(await present(await loadProfile(scope.buyerId)));
    },
  },
});
