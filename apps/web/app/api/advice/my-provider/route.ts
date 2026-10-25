import { BUYER_ROLE, FARMER_ROLE, adviceProviderSchema } from '@agri-erp/shared';

import { loadOwnProvider, presentOwnProvider } from '../../../../lib/api/advice';
import { audited, writeAudit } from '../../../../lib/api/audit';
import { notFound, unprocessable } from '../../../../lib/api/errors';
import { actorOf, me } from '../../../../lib/api/messaging';
import { created, defineRoutes, ok } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * /api/advice/my-provider -- the caller's own advice profile (2026-10-22).
 * docs/DECISIONS.md, "Advice: find a provider and ask".
 *
 * GET returns it, or `{ profile: null }` when the account has none -- which is
 * also how the menu knows whether to offer My Advisory Work.
 *
 * PUT saves it whole: the first save creates it (201), later saves replace it
 * (200). The owner publishes, unpublishes or keeps it as a draft through
 * `status`, with no review by anyone: participation is independent, and public
 * visibility is not endorsement. One profile per account, owned by the
 * sign-in, so a farmer and a buyer record on one account share it.
 * (2026-10-28: an organisation's advice profile is a separate row, managed at
 * /api/organizations/:id/advice-provider; this route never reads or writes it.)
 *
 * Audited as `advice_provider.saved`, carrying the status and the NAMES of the
 * fields that changed, never their text. A save that changes nothing writes
 * nothing.
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

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth }) => {
      const row = await loadOwnProvider(prisma, me(auth));
      return ok({ profile: row ? presentOwnProvider(row) : null });
    },
  },

  PUT: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: adviceProviderSchema,
    handler: async ({ auth, body }) => {
      const owner = me(auth);

      if (body.state_ids.length > 0) {
        const [found] = await prisma.$queryRawUnsafe<{ n: number }[]>(
          'SELECT count(*)::int AS n FROM public.state_active WHERE id = ANY ($1::text[])',
          body.state_ids,
        );
        if ((found?.n ?? 0) !== body.state_ids.length) throw unprocessable('state_not_found');
      }

      const result = await audited(prisma, async (tx) => {
        const before = await loadOwnProvider(tx, owner, true);
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
          // ON CONFLICT: a second first-save from another tab is the same profile.
          const [row] = await tx.$queryRawUnsafe<{ id: string }[]>(
            `INSERT INTO public.advice_provider
               (auth_user_id, display_name, provider_kind, description, topics, languages,
                state_ids, delivery_modes, availability, terms, fee_note, commercial_interests,
                status)
             VALUES ($1::uuid, $2, $3, $4, $5::text[], $6::text[], $7::text[], $8::text[],
                     $9, $10, $11, $12, $13)
             ON CONFLICT (auth_user_id) WHERE organization_id IS NULL DO NOTHING
             RETURNING id`,
            owner,
            ...values,
          );
          if (row) {
            await writeAudit(tx, {
              entityType: 'advice_provider',
              entityId: row.id,
              ...actorOf(auth),
              action: 'advice_provider.saved',
              after: { status: body.status, created: true },
            });
            return { fresh: true, row: await loadOwnProvider(tx, owner) };
          }
        }

        const current = before ?? (await loadOwnProvider(tx, owner, true));
        if (!current) throw notFound(); // unreachable: the conflict was this account's row
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
          ...actorOf(auth),
          action: 'advice_provider.saved',
          before: { status: current.status },
          after: { status: body.status, changed },
        });
        return { fresh: false, row: await loadOwnProvider(tx, owner) };
      });

      if (!result.row) throw notFound(); // unreachable: just written
      const profile = presentOwnProvider(result.row);
      return result.fresh ? created(profile) : ok(profile);
    },
  },
});
