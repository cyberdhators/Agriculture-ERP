import {
  ACCOUNT_DETAIL_KINDS,
  holdsPermission,
  isSuperAdmin,
  maskEmail,
  maskPhone,
  toIso,
  type AccountDetailKind,
  type AccountTimelineItem,
  type AdminAccountDetail,
} from '@agri-erp/shared';

import {
  accountRowQuery,
  presentAccountRow,
  type AccountSqlRow,
} from '../../../../../../lib/api/admin-accounts';
import { forbidden, notFound } from '../../../../../../lib/api/errors';
import { accountOf, standingOf } from '../../../../../../lib/api/moderation';
import { permissionsOf } from '../../../../../../lib/api/permissions';
import { defineRoutes, ok } from '../../../../../../lib/api/route';
import { prisma } from '../../../../../../lib/db';
import { authEmailFacts } from '../../../../../../lib/supabase/admin';

/**
 * GET /api/admin/accounts/:kind/:id -- ONE ACCOUNT as authorised staff see it
 * (2026-10-28; infographic "Profile creation and visibility", panel 4).
 * `kind` is farmer or buyer (either record of the account opens the whole
 * account) or organisation.
 *
 * ADMINISTRATOR ONLY, then `support.handle` or `content.moderate`.
 *
 * - The profile, the account's records and organisations, its standing.
 * - CONTACTS MASKED: the phone and (for an email sign-in) the address, each
 *   with whether it was verified. Revealing one is a separate, audited call
 *   (./reveal) for `support.handle` only. A password is never anywhere.
 * - ACTIVITY: sign-in events (access_log) and what the account itself did
 *   (audit_event action keys only -- never before/after).
 * - STAFF ACTIONS on the account's records: the action, who, when, and the
 *   staff member's written reason when it carries one.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const { GET, POST, PUT, PATCH, DELETE } = defineRoutes({
  GET: {
    roles: ['admin', 'supervisor', 'read_only'],
    handler: async ({ auth, params }) => {
      const permissions = await permissionsOf(auth);
      const canReveal = holdsPermission(permissions, 'support.handle');
      const canModerate = holdsPermission(permissions, 'content.moderate');
      if (!canReveal && !canModerate) throw forbidden();

      const kind = params.kind ?? '';
      const id = params.id ?? '';
      if (!(ACCOUNT_DETAIL_KINDS as readonly string[]).includes(kind) || !UUID.test(id)) {
        throw notFound();
      }
      const q = accountRowQuery(kind as AccountDetailKind, id);
      const [row] = await prisma.$queryRawUnsafe<AccountSqlRow[]>(q.sql, ...q.params);
      if (!row) throw notFound();

      const recordIds = [row.farmer_id, row.buyer_id].filter((x): x is string => x !== null);
      const entityIds = row.kind === 'organisation' ? [row.id] : recordIds;

      const staffRows = await prisma.$queryRawUnsafe<
        { occurred_at: Date; action: string; actor_name: string | null; reason: string | null }[]
      >(
        `SELECT a.occurred_at, a.action, u.name AS actor_name, a.after->>'reason' AS reason
           FROM public.audit_event a
           LEFT JOIN public."user" u ON u.id = a.actor_id
          WHERE a.entity_id = ANY ($1::text[])
            AND a.actor_type IN ('admin', 'supervisor', 'read_only')
          ORDER BY a.occurred_at DESC, a.id DESC
          LIMIT 50`,
        entityIds,
      );

      let timeline: AccountTimelineItem[] = [];
      let organisations: AdminAccountDetail['organisations'] = [];
      let profile: AdminAccountDetail['profile'] = null;
      let buyerOrganization: AdminAccountDetail['records']['buyer_organization'] = null;
      let standing: AdminAccountDetail['standing'] = null;
      let emailMasked: string | null = null;
      let emailConfirmed: boolean | null = null;

      if (row.kind !== 'organisation') {
        const access = await prisma.$queryRawUnsafe<{ occurred_at: Date; event: string }[]>(
          `SELECT occurred_at, event FROM public.access_log
            WHERE (principal_kind = 'farmer' AND principal_id = $1::uuid)
               OR (principal_kind = 'buyer' AND principal_id = $2::uuid)
            ORDER BY occurred_at DESC LIMIT 30`,
          row.farmer_id,
          row.buyer_id,
        );
        const own = await prisma.$queryRawUnsafe<{ occurred_at: Date; action: string }[]>(
          `SELECT occurred_at, action FROM public.audit_event
            WHERE actor_type IN ('farmer', 'buyer') AND actor_id = ANY ($1::uuid[])
            ORDER BY occurred_at DESC, id DESC LIMIT 30`,
          recordIds,
        );
        timeline = [
          ...access.map((a) => ({
            at: toIso(a.occurred_at),
            source: 'access' as const,
            event: a.event,
          })),
          ...own.map((a) => ({
            at: toIso(a.occurred_at),
            source: 'action' as const,
            event: a.action,
          })),
        ]
          .sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0))
          .slice(0, 40);

        if (row.auth_user_id) {
          organisations = (
            await prisma.$queryRawUnsafe<
              { id: string; name: string; role: string; status: string }[]
            >(
              `SELECT o.id, o.name, m.preset AS role, m.status
                 FROM public.organization_member m
                 JOIN public.organization o ON o.id = m.organization_id AND o.deleted_at IS NULL
                WHERE m.auth_user_id = $1::uuid
                ORDER BY (m.status = 'active') DESC, o.name`,
              row.auth_user_id,
            )
          ).map((o) => ({ id: o.id, name: o.name, role: o.role, status: o.status }));
          const [p] = await prisma.$queryRawUnsafe<
            {
              display_name: string | null;
              about: string | null;
              profile_kind: string | null;
              public_id: string | null;
            }[]
          >(
            `SELECT display_name, about, profile_kind, public_id
               FROM public.account_profile WHERE auth_user_id = $1::uuid`,
            row.auth_user_id,
          );
          profile = p ?? null;
          if (row.sign_in === 'email') {
            const facts = await authEmailFacts(row.auth_user_id);
            emailMasked = facts ? maskEmail(facts.email) : null;
            emailConfirmed = facts ? facts.confirmed : null;
          }
        }
        if (row.buyer_id) {
          const [bo] = await prisma.$queryRawUnsafe<
            { id: string; name: string; verification: string }[]
          >(
            `SELECT o.id, o.name, o.verification_status::text AS verification
               FROM public.buyer b JOIN public.buyer_organization o ON o.id = b.organization_id
              WHERE b.id = $1::uuid`,
            row.buyer_id,
          );
          buyerOrganization = bo ?? null;
        }
        const start = row.farmer_id
          ? ({ kind: 'farmer', id: row.farmer_id } as const)
          : ({ kind: 'buyer', id: row.buyer_id! } as const);
        standing = standingOf(await accountOf(prisma, start.kind, start.id));
      }

      const detail: AdminAccountDetail = {
        row: presentAccountRow(row),
        records: {
          farmer_id: row.farmer_id,
          buyer_id: row.buyer_id,
          buyer_organization: buyerOrganization,
        },
        profile,
        contacts: {
          phone_masked: maskPhone(row.phone),
          phone_verified: row.phone_verified === true,
          email_masked: emailMasked,
          email_confirmed: emailConfirmed,
          can_reveal: canReveal,
        },
        standing,
        can_reenable: isSuperAdmin(permissions),
        can_moderate: canModerate,
        organisations,
        timeline,
        staff_actions: staffRows.map((s) => ({
          at: toIso(s.occurred_at),
          action: s.action,
          actor_name: s.actor_name,
          reason: s.reason,
        })),
      };
      return ok(detail, { 'cache-control': 'no-store' });
    },
  },
});
