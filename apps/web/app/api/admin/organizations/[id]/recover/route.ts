import { ORG_PERMISSIONS, recoverOrganizationSchema } from '@agri-erp/shared';

import { recordReauthFailed } from '../../../../../../lib/api/access-log';
import { audited, writeAudit } from '../../../../../../lib/api/audit';
import { notFound, unprocessable } from '../../../../../../lib/api/errors';
import { checkId } from '../../../../../../lib/api/market-posts';
import { notifyAccount } from '../../../../../../lib/api/notify';
import { loadOrganization, lockTeam } from '../../../../../../lib/api/organizations';
import { requirePermission } from '../../../../../../lib/api/permissions';
import { reauthenticate } from '../../../../../../lib/api/reauth';
import { defineRoutes, ok } from '../../../../../../lib/api/route';
import { requireReauth } from '../../../../../../lib/api/staff-access';
import { prisma } from '../../../../../../lib/db';

/**
 * POST /api/admin/organizations/:id/recover -- EVIDENCE-BASED EXCEPTIONAL
 * RECOVERY (2026-10-27, the specification: "Support ... evidence-based
 * exceptional recovery"). For the case the ordinary process cannot reach: the
 * administrators have lost access (a lost phone, a death, a departure without
 * handover) and a person the organisation recognises asks to administer it.
 *
 * A staff administrator with `support.handle`, re-authenticated by password,
 * names a person who is or was a member (by their membership id), a reason,
 * and the evidence relied on (a reference, not a file). That person becomes
 * an Administrator: their active membership is raised, or -- if theirs had
 * ended -- a new active membership is made, the old row kept as history.
 * Nobody else's access changes. Audited as `organization.recovered` with the
 * staff actor, the reason and the evidence; the person is told in the app.
 *
 * It never grants a staff permission, AgriOne verification or advisory
 * approval, and it is refused on a closed organisation.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: ['admin'],
    bodySchema: recoverOrganizationSchema,
    handler: async ({ auth, params, body, request }) => {
      await requirePermission(auth, 'support.handle');
      const id = checkId(params.id);
      await requireReauth(await reauthenticate(auth.principal.authUserId, body.password), () =>
        recordReauthFailed(auth, request),
      );

      const result = await audited(prisma, async (tx) => {
        await lockTeam(tx, id);
        const organization = await loadOrganization(tx, id, true);
        if (organization.closed_at) throw unprocessable('organization_closed');
        const [named] = await tx.$queryRawUnsafe<
          { id: string; auth_user_id: string; status: string; preset: string }[]
        >(
          `SELECT id, auth_user_id, status, preset FROM public.organization_member
            WHERE id = $1::uuid AND organization_id = $2::uuid`,
          body.member_id,
          id,
        );
        if (!named) throw notFound();
        const [active] = await tx.$queryRawUnsafe<{ id: string; preset: string }[]>(
          `SELECT id, preset FROM public.organization_member
            WHERE organization_id = $1::uuid AND auth_user_id = $2::uuid AND status = 'active'
            FOR UPDATE`,
          id,
          named.auth_user_id,
        );
        let memberId: string;
        let previous: string;
        if (active) {
          memberId = active.id;
          previous = active.preset;
          await tx.$queryRawUnsafe(
            `UPDATE public.organization_member
                SET preset = 'administrator', permissions = $2::text[], updated_at = now()
              WHERE id = $1::uuid`,
            active.id,
            [...ORG_PERMISSIONS],
          );
        } else {
          previous = `${named.status} ${named.preset}`;
          const [row] = await tx.$queryRawUnsafe<{ id: string }[]>(
            `INSERT INTO public.organization_member
               (organization_id, auth_user_id, preset, permissions)
             VALUES ($1::uuid, $2::uuid, 'administrator', $3::text[]) RETURNING id`,
            id,
            named.auth_user_id,
            [...ORG_PERMISSIONS],
          );
          memberId = row!.id;
        }
        await writeAudit(tx, {
          entityType: 'organization',
          entityId: id,
          actorType: auth.role,
          actorId: auth.principal.id,
          action: 'organization.recovered',
          before: { member_id: named.id, was: previous },
          after: {
            member_id: memberId,
            preset: 'administrator',
            reason: body.reason,
            evidence: body.evidence,
          },
        });
        await notifyAccount(tx, { authUserId: named.auth_user_id }, 'organization_recovered', {
          actorType: auth.role,
          actorId: auth.principal.id,
        });
        return { organization_id: id, member_id: memberId, preset: 'administrator' };
      });
      return ok(result);
    },
  },
});
