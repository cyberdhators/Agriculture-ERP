import { BUYER_ROLE, FARMER_ROLE, adviserApplicationSchema } from '@agri-erp/shared';

import { loadOwnProvider } from '../../../../../lib/api/advice';
import {
  applicationsOf,
  openApplicationOf,
  presentOwnApplication,
} from '../../../../../lib/api/adviser-approval';
import { audited, writeAudit } from '../../../../../lib/api/audit';
import { unprocessable } from '../../../../../lib/api/errors';
import { actorOf, me } from '../../../../../lib/api/messaging';
import { created, defineRoutes, ok } from '../../../../../lib/api/route';
import { prisma } from '../../../../../lib/db';

/**
 * /api/advice/my-provider/application -- the caller's OPTIONAL application to
 * be an approved adviser (2026-10-24). docs/DECISIONS.md, "Approved advisers:
 * optional, reviewed, revocable".
 *
 * GET: whether the caller's advice profile holds the badge now, the newest
 * application, and every application, newest first. An account with no
 * advice profile gets `{ approved: false, current: null, history: [] }`.
 *
 * POST: apply. Needs an advice profile (any status: approval is about the
 * person, publication is the owner's own choice). Refused while another
 * application is with CORWADO, or while the profile is approved. Both
 * acknowledgements must be ticked (the shared schema accepts only true).
 *
 * Nothing about applying changes what the account can do: buying, selling,
 * publishing an advice profile and taking requests all go on as before.
 * Audited as `adviser_application.submitted` with ids and the status only,
 * never the application's text.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth }) => {
      const provider = await loadOwnProvider(prisma, me(auth));
      if (!provider) return ok({ approved: false, approved_at: null, current: null, history: [] });
      const history = (await applicationsOf(prisma, provider.id)).map(presentOwnApplication);
      return ok({
        approved: provider.approved_at !== null,
        approved_at: provider.approved_at ? provider.approved_at.toISOString() : null,
        current: history[0] ?? null,
        history,
      });
    },
  },

  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: adviserApplicationSchema,
    handler: async ({ auth, body }) => {
      const owner = me(auth);

      if (body.service_area.length > 0) {
        const [found] = await prisma.$queryRawUnsafe<{ n: number }[]>(
          'SELECT count(*)::int AS n FROM public.state_active WHERE id = ANY ($1::text[])',
          body.service_area,
        );
        if ((found?.n ?? 0) !== body.service_area.length) throw unprocessable('state_not_found');
      }

      const row = await audited(prisma, async (tx) => {
        // Locking the profile row queues a second Submit from another tab
        // behind this one, so it sees this application and is refused.
        const provider = await loadOwnProvider(tx, owner, true);
        if (!provider) throw unprocessable('adviser_profile_required');
        if (provider.approved_at) throw unprocessable('adviser_already_approved');
        if (await openApplicationOf(tx, provider.id)) {
          throw unprocessable('adviser_application_open');
        }

        const [inserted] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `INSERT INTO public.adviser_application
             (provider_id, auth_user_id, specialties, service_area, languages, experience,
              qualifications, affiliation, accurate_information, disclose_interests, status)
           VALUES ($1::uuid, $2::uuid, $3::text[], $4::text[], $5::text[], $6, $7, $8,
                   $9, $10, 'submitted')
           RETURNING id`,
          provider.id,
          owner,
          body.specialties,
          body.service_area,
          body.languages,
          body.experience,
          body.qualifications,
          body.affiliation,
          body.accurate_information,
          body.disclose_interests,
        );
        if (!inserted) throw unprocessable('adviser_application_open'); // unreachable
        await writeAudit(tx, {
          entityType: 'adviser_application',
          entityId: inserted.id,
          ...actorOf(auth),
          action: 'adviser_application.submitted',
          after: { status: 'submitted', provider_id: provider.id },
        });
        const [fresh] = await applicationsOf(tx, provider.id);
        return fresh;
      });

      if (!row) throw unprocessable('adviser_profile_required'); // unreachable: just written
      return created(presentOwnApplication(row));
    },
  },
});
