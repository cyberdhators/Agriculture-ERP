import { BUYER_ROLE, FARMER_ROLE, adviceProviderSchema, memberMay } from '@agri-erp/shared';

import { loadOrganizationProvider, presentOwnProvider } from '../../../../../lib/api/advice';
import { audited, writeAudit } from '../../../../../lib/api/audit';
import { forbidden, notFound, unprocessable } from '../../../../../lib/api/errors';
import { checkId } from '../../../../../lib/api/market-posts';
import {
  actorFor,
  asMember,
  personOf,
  requireMember,
  type MemberRow,
} from '../../../../../lib/api/organizations';
import { created, defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * /api/organizations/:id/advice-provider -- an ORGANISATION's advice profile
 * (2026-10-28). docs/DECISIONS.md, "Organisation advice cases".
 *
 * The same profile a person can publish (adviceProviderSchema), owned by the
 * organisation: requests to it go to the organisation's shared advice inbox,
 * which only members holding `advisory.handle` open. A member's personal
 * advice profile is a separate row and is never read or changed here.
 *
 * GET: any active member (404 to anyone else), `{ profile: null }` when the
 * organisation has none. PUT: members holding `profile.edit` or
 * `advisory.handle`, while the organisation is open. The first save creates
 * it (201); later saves replace it. Published at once, with no review:
 * public visibility is not endorsement, and the approved-adviser pathway
 * stays a person's.
 *
 * Audited as `advice_provider.saved` with the organisation, the status and
 * the NAMES of the fields that changed, never their text. The person acting
 * is the actor.
 */

const FIELDS = [
  'display_name',
  'provider_kind',
  'description',
  'topics',
  'languages',
  'state_ids',
  'delivery_modes',
  'availability',
  'terms',
  'fee_note',
  'commercial_interests',
  'status',
] as const;

const same = (a: unknown, b: unknown) =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && [...a].sort().join('\u0000') === [...b].sort().join('\u0000')
    : (a ?? null) === (b ?? null);

/** Who may edit the organisation's advice profile. */
const mayEdit = (member: MemberRow) =>
  memberMay(asMember(member), 'profile.edit') || memberMay(asMember(member), 'advisory.handle');

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth, params }) => {
      const me = personOf(auth);
      const { organization, member } = await requireMember(prisma, checkId(params.id), me);
      const row = await loadOrganizationProvider(prisma, organization.id);
      return ok({
        profile: row ? presentOwnProvider(row) : null,
        may_edit: mayEdit(member) && organization.closed_at === null,
      });
    },
  },

  PUT: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: adviceProviderSchema,
    handler: async ({ auth, body, params }) => {
      const me = personOf(auth);
      const organizationId = checkId(params.id);

      if (body.state_ids.length > 0) {
        const [found] = await prisma.$queryRawUnsafe<{ n: number }[]>(
          'SELECT count(*)::int AS n FROM public.state_active WHERE id = ANY ($1::text[])',
          body.state_ids,
        );
        if ((found?.n ?? 0) !== body.state_ids.length) throw unprocessable('state_not_found');
      }

      const result = await audited(prisma, async (tx) => {
        const { member } = await requireMember(tx, organizationId, me, {
          open: true,
          lock: true,
        });
        if (!mayEdit(member)) throw forbidden();

        const before = await loadOrganizationProvider(tx, organizationId, true);
        const values = [
          body.display_name,
          body.provider_kind,
          body.description,
          body.topics,
          body.languages,
          body.state_ids,
          body.delivery_modes,
          body.availability,
          body.terms,
          body.fee_note,
          body.commercial_interests,
          body.status,
        ];

        if (!before) {
          // ON CONFLICT: a second first-save from another member is the same profile.
          const [row] = await tx.$queryRawUnsafe<{ id: string }[]>(
            `INSERT INTO public.advice_provider
               (auth_user_id, organization_id, display_name, provider_kind, description,
                topics, languages, state_ids, delivery_modes, availability, terms, fee_note,
                commercial_interests, status)
             VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::text[], $7::text[], $8::text[],
                     $9::text[], $10, $11, $12, $13, $14)
             ON CONFLICT (organization_id) WHERE organization_id IS NOT NULL DO NOTHING
             RETURNING id`,
            me,
            organizationId,
            ...values,
          );
          if (row) {
            await writeAudit(tx, {
              entityType: 'advice_provider',
              entityId: row.id,
              ...actorFor(auth),
              action: 'advice_provider.saved',
              after: { status: body.status, created: true, organization_id: organizationId },
            });
            return { fresh: true, row: await loadOrganizationProvider(tx, organizationId) };
          }
        }

        const current = before ?? (await loadOrganizationProvider(tx, organizationId, true));
        if (!current) throw notFound(); // unreachable: the conflict was this organisation's row
        const changed = FIELDS.filter((key) => !same(current[key], body[key]));
        if (changed.length === 0) return { fresh: false, row: current };

        await tx.$queryRawUnsafe(
          `UPDATE public.advice_provider
              SET display_name = $2, provider_kind = $3, description = $4, topics = $5::text[],
                  languages = $6::text[], state_ids = $7::text[], delivery_modes = $8::text[],
                  availability = $9, terms = $10, fee_note = $11, commercial_interests = $12,
                  status = $13, updated_at = now()
            WHERE id = $1::uuid`,
          current.id,
          ...values,
        );
        await writeAudit(tx, {
          entityType: 'advice_provider',
          entityId: current.id,
          ...actorFor(auth),
          action: 'advice_provider.saved',
          before: { status: current.status },
          after: { status: body.status, changed, organization_id: organizationId },
        });
        return { fresh: false, row: await loadOrganizationProvider(tx, organizationId) };
      });

      if (!result.row) throw notFound(); // unreachable: just written
      const profile = presentOwnProvider(result.row);
      return result.fresh ? created(profile) : ok(profile);
    },
  },
});
