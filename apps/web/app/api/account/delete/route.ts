import { BUYER_ROLE, FARMER_ROLE, deleteAccountSchema, deletionResolution } from '@agri-erp/shared';

import { recordReauthFailed } from '../../../../lib/api/access-log';
import { audited, writeAudit } from '../../../../lib/api/audit';
import { forbidden, unprocessable } from '../../../../lib/api/errors';
import { notifyAccount } from '../../../../lib/api/notify';
import {
  asMember,
  closeOrganization,
  loadMembers,
  lockTeam,
} from '../../../../lib/api/organizations';
import { reauthenticate } from '../../../../lib/api/reauth';
import { defineRoutes, ok } from '../../../../lib/api/route';
import { requireReauth } from '../../../../lib/api/staff-access';
import { prisma } from '../../../../lib/db';
import { disableAuthAccount } from '../../../../lib/supabase/admin';

/**
 * POST /api/account/delete -- "Delete my account" (2026-10-20, CORWADO's 16
 * October specification). The owner: hide now, keep for audit.
 *
 * The account's own password first (lib/api/reauth.ts, the Super Admin check:
 * a throwaway sign-in, the password never kept), then, in ONE transaction:
 *
 *   - every live post withdrawn: produce listings, buying requests, services;
 *   - every conversation closed, and the account's name in it replaced by
 *     "Former member" -- what was said stays for the other person;
 *   - the farmer and the buyer record soft-deleted (deleted_at; never removed),
 *     so they leave every list, count, export and the market;
 *   - one audit row per record, carrying what was withdrawn and closed.
 *
 * Then the sign-in is disabled (banned), which also ends sessions on other
 * phones. If Supabase does not answer, the records are already deleted and
 * requireRole refuses the account everywhere (it reads the _active views), so
 * the ban is a second lock, not the only one; the answer says which happened.
 *
 * Coming back: the phone and sign-in stay attached to the deleted record, so
 * a new account with the same phone is refused; restoring is CORWADO's, by
 * hand, for now. Staff accounts cannot use this route.
 *
 * 2026-10-27 (team access): ORGANISATIONS, BY A DEFINED PROCESS. Where
 * someone else administers an organisation, the person's membership simply
 * ends (left); the organisation, its posts and its inbox go on. Where they are
 * its LAST administrator, deletion is refused (organization_last_admin_delete)
 * until they choose `close_organizations: true`, which closes those
 * organisations in the same transaction -- or they hand administration over
 * first. Either way nobody else's agreement is needed, so deletion is never
 * blocked indefinitely. Only PERSONAL posts and conversations are withdrawn
 * and closed here; an open organisation's stay with it.
 */
export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  POST: {
    roles: [FARMER_ROLE, BUYER_ROLE],
    bodySchema: deleteAccountSchema,
    handler: async ({ auth, body, request }) => {
      if (auth.principal.kind !== 'farmer' && auth.principal.kind !== 'buyer') throw forbidden();
      const me = auth.principal.authUserId;

      await requireReauth(await reauthenticate(me, body.password), () =>
        recordReauthFailed(auth, request),
      );

      await audited(prisma, async (tx) => {
        // Organisations first: refuse before anything else changes.
        const memberships = await tx.$queryRawUnsafe<{ organization_id: string; id: string }[]>(
          `SELECT m.organization_id, m.id FROM public.organization_member m
             JOIN public.organization o ON o.id = m.organization_id
            WHERE m.auth_user_id = $1::uuid AND m.status = 'active'
              AND o.deleted_at IS NULL AND o.closed_at IS NULL
            ORDER BY m.organization_id`,
          me,
        );
        const teams = [];
        for (const m of memberships) {
          await lockTeam(tx, m.organization_id);
          const members = await loadMembers(tx, m.organization_id);
          const mine = members.find((x) => x.id === m.id);
          if (mine) {
            teams.push({
              organizationId: m.organization_id,
              member: asMember(mine),
              members: members.map(asMember),
              others: members.filter((x) => x.status === 'active' && x.id !== m.id),
            });
          }
        }
        const resolution = deletionResolution(teams);
        if (resolution.mustClose.length > 0 && body.close_organizations !== true) {
          throw unprocessable('organization_last_admin_delete');
        }
        const actor = {
          actorType: auth.principal.kind as 'farmer' | 'buyer',
          actorId: auth.principal.id,
        };
        for (const team of teams) {
          if (resolution.mustClose.includes(team.organizationId)) {
            await closeOrganization(tx, {
              organizationId: team.organizationId,
              closedBy: me,
              reason: 'The last administrator deleted their account.',
              actor,
            });
            for (const other of team.others) {
              await notifyAccount(
                tx,
                { authUserId: other.auth_user_id },
                'organization_access_ended',
                actor,
              );
            }
          } else {
            await tx.$queryRawUnsafe(
              `UPDATE public.organization_member
                  SET status = 'left', ended_at = now(), ended_by = $2::uuid,
                      end_reason = 'Deleted their account.', updated_at = now()
                WHERE id = $1::uuid`,
              team.member.id,
              me,
            );
            await tx.$queryRawUnsafe(
              `UPDATE public.organization_invitation SET status = 'cancelled', updated_at = now()
                WHERE (target_member_id = $1::uuid OR invited_by_member_id = $1::uuid)
                  AND kind = 'transfer' AND status = 'pending'`,
              team.member.id,
            );
            await writeAudit(tx, {
              entityType: 'organization_member',
              entityId: team.member.id,
              ...actor,
              action: 'organization_member.left',
              before: { status: 'active' },
              after: { status: 'left', organization_id: team.organizationId, by: 'account_deleted' },
            });
          }
        }

        const [farmer] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM public.farmer
            WHERE auth_user_id = $1::uuid AND deleted_at IS NULL FOR UPDATE`,
          me,
        );
        const [buyer] = await tx.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM public.buyer
            WHERE auth_user_id = $1::uuid AND deleted_at IS NULL FOR UPDATE`,
          me,
        );
        const farmerId = farmer?.id ?? null;
        const buyerId = buyer?.id ?? null;

        const count = async (sql: string, ...args: unknown[]) =>
          (await tx.$queryRawUnsafe<{ id: string }[]>(sql, ...args)).length;

        const listings = farmerId
          ? await count(
              `UPDATE public.produce_listing SET status = 'withdrawn', updated_at = now()
                WHERE farmer_id = $1::uuid AND deleted_at IS NULL
                  AND status IN ('draft', 'listed', 'paused')
                RETURNING id`,
              farmerId,
            )
          : 0;
        const requests = await count(
          `UPDATE public.buying_request SET status = 'withdrawn', updated_at = now()
            WHERE (farmer_id = $1::uuid OR buyer_id = $2::uuid) AND deleted_at IS NULL
              AND organization_id IS NULL
              AND status IN ('draft', 'active', 'paused')
            RETURNING id`,
          farmerId,
          buyerId,
        );
        // 2026-10-26: a buyer account's services are withdrawn with it too.
        const services = await count(
          `UPDATE public.service_listing SET status = 'withdrawn', updated_at = now()
            WHERE (farmer_id = $1::uuid OR buyer_id = $2::uuid) AND deleted_at IS NULL
              AND organization_id IS NULL
              AND status IN ('draft', 'active', 'paused')
            RETURNING id`,
          farmerId,
          buyerId,
        );
        const conversations = await count(
          `UPDATE public.conversation
              SET owner_name = CASE WHEN owner_auth_user_id = $1::uuid
                                     AND owner_organization_id IS NULL
                                    THEN 'Former member' ELSE owner_name END,
                  starter_name = CASE WHEN starter_auth_user_id = $1::uuid
                                       AND starter_organization_id IS NULL
                                      THEN 'Former member' ELSE starter_name END,
                  blocked_at = COALESCE(blocked_at, now()),
                  blocked_by = COALESCE(blocked_by, $1::uuid)
            WHERE (owner_auth_user_id = $1::uuid AND owner_organization_id IS NULL)
               OR (starter_auth_user_id = $1::uuid AND starter_organization_id IS NULL)
            RETURNING id`,
          me,
        );
        const after = {
          self_deleted: true,
          listings_withdrawn: listings,
          buying_requests_withdrawn: requests,
          services_withdrawn: services,
          conversations_closed: conversations,
          organizations_left: resolution.leave.length,
          organizations_closed: resolution.mustClose.length,
        };

        if (farmerId) {
          await tx.$executeRawUnsafe(
            `UPDATE public.farmer SET deleted_at = now() WHERE id = $1::uuid`,
            farmerId,
          );
          await writeAudit(tx, {
            entityType: 'farmer',
            entityId: farmerId,
            actorType: 'farmer',
            actorId: farmerId,
            action: 'farmer.soft_deleted',
            before: { deleted_at: null },
            after,
          });
        }
        if (buyerId) {
          await tx.$executeRawUnsafe(
            `UPDATE public.buyer SET deleted_at = now() WHERE id = $1::uuid`,
            buyerId,
          );
          await writeAudit(tx, {
            entityType: 'buyer',
            entityId: buyerId,
            actorType: 'buyer',
            actorId: buyerId,
            action: 'buyer.soft_deleted',
            before: { deleted_at: null },
            after,
          });
        }
      });

      let signInDisabled = true;
      try {
        await disableAuthAccount(me);
      } catch {
        signInDisabled = false;
      }
      return ok({ deleted: true, sign_in_disabled: signInDisabled });
    },
  },
});
