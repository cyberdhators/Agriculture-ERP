import {
  counterpartVisible,
  memberMay,
  presenceChannel,
  PRESENCE_PREFIX,
  type ConversationSummary,
  type CounterpartPresence,
  type MemberLike,
} from '@agri-erp/shared';

import { occupiedPresenceChannels } from '../realtime/publish';
import { type AuditTx } from './audit';
import { type ConversationRow, sideOf, type Viewer } from './messaging';

/**
 * ONLINE NOW AND LAST ACTIVE, SERVER SIDE (2026-10-26). The rule is
 * shared/src/presence.ts `counterpartVisible`; this file reads the facts.
 *
 * ONLINE: each account joins only its OWN presence channel (and only while
 * its switch is on; the channel-authorization route refuses otherwise).
 * Nobody subscribes to anyone else's -- so no client ever learns who else is
 * online. The server asks Bird which presence channels are occupied (one
 * request, cached ten seconds) and answers per conversation.
 *
 * LAST ACTIVE: account_activity.last_seen_at (lane-security), moved at most
 * every five minutes on API calls, read for the farmer and buyer records of
 * the other person's sign-in.
 */

type Db = { $queryRawUnsafe: AuditTx['$queryRawUnsafe'] };

/**
 * The accounts' "show when I'm active" switches (no row: on). Read through
 * to_jsonb so a database without migration 20261101090000 reads every
 * switch as on rather than failing the conversation list.
 */
export async function showsActivity(
  db: Db,
  authUserIds: readonly string[],
): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>(authUserIds.map((id) => [id, true]));
  if (authUserIds.length === 0) return out;
  const rows = await db.$queryRawUnsafe<{ auth_user_id: string; show: boolean | null }[]>(
    `SELECT p.auth_user_id, (to_jsonb(p) ->> 'show_activity')::boolean AS show
       FROM public.notification_preference p WHERE p.auth_user_id = ANY ($1::uuid[])`,
    [...authUserIds],
  );
  for (const r of rows) out.set(r.auth_user_id, r.show !== false);
  return out;
}

/** The newest last-activity of each sign-in, over its farmer and buyer records. */
async function lastActive(db: Db, authUserIds: readonly string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (authUserIds.length === 0) return out;
  const rows = await db.$queryRawUnsafe<{ auth_user_id: string; at: Date | null }[]>(
    `SELECT x.auth_user_id, max(a.last_seen_at) AS at
       FROM (SELECT f.auth_user_id, 'farmer'::text AS kind, f.id FROM public.farmer f
              WHERE f.auth_user_id = ANY ($1::uuid[]) AND f.deleted_at IS NULL
             UNION ALL
             SELECT b.auth_user_id, 'buyer'::text, b.id FROM public.buyer b
              WHERE b.auth_user_id = ANY ($1::uuid[]) AND b.deleted_at IS NULL) x
       JOIN public.account_activity a
         ON a.principal_kind = x.kind AND a.principal_id = x.id
      GROUP BY x.auth_user_id`,
    [...authUserIds],
  );
  for (const r of rows) if (r.at) out.set(r.auth_user_id, r.at);
  return out;
}

/** The other side of a conversation, from the viewer's side: one person, or an organisation. */
export function counterpartOf(
  row: Pick<
    ConversationRow,
    | 'owner_auth_user_id'
    | 'starter_auth_user_id'
    | 'owner_organization_id'
    | 'starter_organization_id'
  >,
  viewer: Viewer,
): { kind: 'person'; authUserId: string } | { kind: 'organization' } {
  const mine = sideOf(row as ConversationRow, viewer);
  const otherOrg = mine === 'owner' ? row.starter_organization_id : row.owner_organization_id;
  if (otherOrg) return { kind: 'organization' };
  return {
    kind: 'person',
    authUserId: mine === 'owner' ? row.starter_auth_user_id : row.owner_auth_user_id,
  };
}

/**
 * Adds `presence` to each conversation the viewer may see it on, and leaves
 * it null everywhere else. NEVER THROWS: a failure reads as "unknown".
 */
export async function withPresence(
  db: Db,
  viewer: Viewer,
  rows: readonly ConversationRow[],
  summaries: ConversationSummary[],
): Promise<ConversationSummary[]> {
  try {
    const others = rows.map((r) => counterpartOf(r, viewer));
    const people = [...new Set(others.flatMap((o) => (o.kind === 'person' ? [o.authUserId] : [])))];
    if (people.length === 0) return summaries.map((s) => ({ ...s, presence: null }));
    const shows = await showsActivity(db, [viewer.person, ...people]);
    const viewerShows = shows.get(viewer.person) !== false;
    if (!viewerShows) return summaries.map((s) => ({ ...s, presence: null }));
    const [seen, online] = await Promise.all([
      lastActive(db, people),
      occupiedPresenceChannels(PRESENCE_PREFIX),
    ]);
    return summaries.map((s, i) => {
      const other = others[i]!;
      const visible = counterpartVisible({
        viewerSignedIn: true,
        viewerShows,
        counterpart: other.kind,
        counterpartShows: other.kind === 'person' ? shows.get(other.authUserId) !== false : false,
      });
      if (!visible || other.kind !== 'person') return { ...s, presence: null };
      const presence: CounterpartPresence = {
        online: online.has(presenceChannel(other.authUserId)),
        last_active_at: seen.get(other.authUserId)?.toISOString() ?? null,
      };
      return { ...s, presence };
    });
  } catch {
    return summaries.map((s) => ({ ...s, presence: null }));
  }
}

/** The caller's memberships, for the channel rule. */
export async function membershipsOf(db: Db, authUserId: string): Promise<Map<string, MemberLike>> {
  const rows = await db.$queryRawUnsafe<(MemberLike & { organization_id: string })[]>(
    `SELECT m.id, m.organization_id, m.preset, m.permissions, m.status
       FROM public.organization_member m
       JOIN public.organization o ON o.id = m.organization_id
      WHERE m.auth_user_id = $1::uuid AND m.status = 'active'
        AND o.deleted_at IS NULL AND o.closed_at IS NULL`,
    authUserId,
  );
  return new Map(rows.map((r) => [r.organization_id, r]));
}

/** The organisation inboxes the caller may read live. */
export const inboxOrganizations = (memberships: ReadonlyMap<string, MemberLike>): string[] =>
  [...memberships.entries()].filter(([, m]) => memberMay(m, 'inbox.read')).map(([id]) => id);
