import { BUYER_ROLE, FARMER_ROLE, publicProfileSaveSchema } from '@agri-erp/shared';

import { audited, writeAudit } from '../../../../lib/api/audit';
import { unprocessable } from '../../../../lib/api/errors';
import { me } from '../../../../lib/api/messaging';
import {
  SAVED_FIELDS,
  loadOwnProfile,
  presentOwnProfile,
  profileActor,
  sameValue,
} from '../../../../lib/api/public-profile';
import { created, defineRoutes, ok } from '../../../../lib/api/route';
import { prisma } from '../../../../lib/db';

/**
 * GET / PUT /api/account/public-profile -- the caller's own public profile
 * (2026-10-23, public profiles v2). docs/DECISIONS.md, "Public profiles v2:
 * drafts, publishing, photo".
 *
 * GET returns it with its status and everything the preview shows (the photo
 * as a read link that expires). Before the first save it returns the empty
 * draft with `public_id: null`.
 *
 * PUT saves the fields whole. SAVING NEVER PUBLISHES: a new profile is a
 * draft, and publishing is POST .../publish, a separate deliberate step. A
 * profile that is already published shows a saved change at once (the owner
 * published it; there is no staff review either way).
 *
 * Owned by the sign-in, so a farmer and a buyer record on one account reach
 * the same profile. Audited as `profile.saved` with the NAMES of the fields
 * that changed -- never the about text, a tag or a name. A save that changes
 * nothing writes nothing.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    handler: async ({ auth }) => {
      const owner = me(auth);
      return ok(await presentOwnProfile(prisma, owner, await loadOwnProfile(prisma, owner)));
    },
  },

  PUT: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: publicProfileSaveSchema,
    handler: async ({ auth, body }) => {
      const owner = me(auth);

      // General location: a live state, and a payam inside it.
      if (body.state_id) {
        const [state] = await prisma.$queryRawUnsafe<{ id: string }[]>(
          'SELECT id FROM public.state_active WHERE id = $1',
          body.state_id,
        );
        if (!state) throw unprocessable('state_not_found');
      }
      if (body.payam_id) {
        const [payam] = await prisma.$queryRawUnsafe<{ id: string }[]>(
          'SELECT id FROM public.payam_active WHERE id = $1 AND state_id = $2',
          body.payam_id,
          body.state_id,
        );
        if (!payam) throw unprocessable('payam_not_found');
      }

      const values = [
        body.display_name,
        body.activities,
        body.state_id,
        body.payam_id,
        body.about,
        body.products,
        body.services,
        body.show_phone,
        body.allow_messages,
      ];

      const fresh = await audited(prisma, async (tx) => {
        const before = await loadOwnProfile(tx, owner, true);
        if (!before) {
          // ON CONFLICT: a first save from another tab is the same profile.
          const [row] = await tx.$queryRawUnsafe<{ public_id: string }[]>(
            `INSERT INTO public.account_profile
               (auth_user_id, display_name, activities, state_id, payam_id, about, products,
                services, show_phone, allow_messages)
             VALUES ($1::uuid, $2, $3::text[], $4, $5, $6, $7::text[], $8::text[], $9, $10)
             ON CONFLICT (auth_user_id) DO NOTHING
             RETURNING public_id`,
            owner,
            ...values,
          );
          if (row) {
            await writeAudit(tx, {
              entityType: 'account_profile',
              entityId: row.public_id,
              ...profileActor(auth),
              action: 'profile.saved',
              after: { status: 'draft', created: true, fields: [...SAVED_FIELDS] },
            });
            return true;
          }
        }

        const current = before ?? (await loadOwnProfile(tx, owner, true));
        if (!current) return false; // unreachable: the conflict was this account's row
        const changed = SAVED_FIELDS.filter((key) => !sameValue(current[key], body[key]));
        if (changed.length === 0) return false;

        await tx.$executeRawUnsafe(
          `UPDATE public.account_profile
              SET display_name = $2, activities = $3::text[], state_id = $4, payam_id = $5,
                  about = $6, products = $7::text[], services = $8::text[], show_phone = $9,
                  allow_messages = $10, updated_at = now()
            WHERE auth_user_id = $1::uuid`,
          owner,
          ...values,
        );
        await writeAudit(tx, {
          entityType: 'account_profile',
          entityId: current.public_id,
          ...profileActor(auth),
          action: 'profile.saved',
          before: { status: current.status },
          after: { status: current.status, changed },
        });
        return false;
      });

      const profile = await presentOwnProfile(prisma, owner, await loadOwnProfile(prisma, owner));
      return fresh ? created(profile) : ok(profile);
    },
  },
});
