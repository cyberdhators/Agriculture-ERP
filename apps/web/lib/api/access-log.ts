import {
  type AccessEvent,
  type AccessPrincipalKind,
  SIGN_IN_ANNOUNCE_HEADER,
  classifyVisit,
  deviceLabel,
} from '@agri-erp/shared';

import { prisma } from '../db';
import { cachedSettingValue } from './settings';
import { type Authenticated } from './require-role';

/**
 * ACCESS LOGS (2026-10-19). Recorded WITHOUT CHANGING BEHAVIOUR.
 *
 * Every function here swallows its own failures and has a deadline: a route
 * that records an access must answer exactly as it did before, whether or not
 * the log table exists yet, whether or not the database is slow. A lost log
 * row is a gap in a log; a broken /api/me is a portal nobody can open.
 *
 * Stored: the account's kind and application id, the event, the UTC time and
 * at most a platform-family device label. Never an IP address, never the
 * user agent, never the auth account id.
 */

/** How long recording may hold up a response before it is abandoned. */
export const ACCESS_LOG_DEADLINE_MS = 2_000;

const withDeadline = async (work: Promise<unknown>): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    work,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ACCESS_LOG_DEADLINE_MS);
    }),
  ]).finally(() => clearTimeout(timer));
};

const kindOf = (auth: Authenticated): AccessPrincipalKind => auth.principal.kind;

async function insertEvent(
  kind: AccessPrincipalKind,
  id: string,
  event: AccessEvent,
  device: string | null,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO public.access_log (principal_kind, principal_id, event, device_label)
     VALUES ($1, $2::uuid, $3, $4)`,
    kind,
    id,
    event,
    device,
  );
}

interface ActivityRow {
  first_sign_in_at: Date | null;
  last_seen_at: Date | null;
}

/**
 * One authenticated visit to a "me" route. Moves "last activity", and writes
 * an event when the visit is a first sign-in, an announced sign-in or a return
 * session (classifyVisit, packages/shared).
 *
 * The previous `last_seen_at` is read by the same statement that moves it, so
 * two requests arriving together each see a different "previous" and only one
 * of them can be a return session.
 */
async function recordVisitUnsafe(auth: Authenticated, request: Request): Promise<void> {
  const kind = kindOf(auth);
  const id = auth.principal.id;
  const signInAnnounced = request.headers.get(SIGN_IN_ANNOUNCE_HEADER) === '1';

  // A new account row: nothing was known before this visit.
  const inserted = await prisma.$queryRawUnsafe<{ principal_id: string }[]>(
    `INSERT INTO public.account_activity (principal_kind, principal_id, last_seen_at)
     VALUES ($1, $2::uuid, now())
     ON CONFLICT (principal_kind, principal_id) DO NOTHING
     RETURNING principal_id`,
    kind,
    id,
  );

  let previous: ActivityRow;
  if (inserted.length > 0) {
    previous = { first_sign_in_at: null, last_seen_at: null };
  } else {
    const [row] = await prisma.$queryRawUnsafe<ActivityRow[]>(
      `UPDATE public.account_activity a
          SET last_seen_at = now()
         FROM (SELECT first_sign_in_at, last_seen_at
                 FROM public.account_activity
                WHERE principal_kind = $1 AND principal_id = $2::uuid
                FOR UPDATE) prev
        WHERE a.principal_kind = $1 AND a.principal_id = $2::uuid
        RETURNING prev.first_sign_in_at, prev.last_seen_at`,
      kind,
      id,
    );
    previous = row ?? { first_sign_in_at: null, last_seen_at: null };
  }

  // 2026-10-27 (settings phase 2): the threshold is Registration and
  // recovery's setting, remembered for a minute; thirty minutes until saved.
  const inactivityMinutes = (await cachedSettingValue('registration_recovery'))
    .session_inactivity_minutes;
  const event = classifyVisit({
    firstSignInAt: previous.first_sign_in_at,
    lastSeenAt: previous.last_seen_at,
    now: new Date(),
    signInAnnounced,
    inactivityMs: inactivityMinutes * 60_000,
  });
  if (!event) return;

  if (event === 'first_sign_in' || event === 'sign_in') {
    await prisma.$executeRawUnsafe(
      `UPDATE public.account_activity
          SET first_sign_in_at = COALESCE(first_sign_in_at, now()),
              last_sign_in_at = now()
        WHERE principal_kind = $1 AND principal_id = $2::uuid`,
      kind,
      id,
    );
  }
  await insertEvent(kind, id, event, deviceLabel(request.headers.get('user-agent')));
}

/** Records a visit. Never throws, never waits longer than ACCESS_LOG_DEADLINE_MS. */
export async function recordVisit(auth: Authenticated, request: Request): Promise<void> {
  try {
    await withDeadline(recordVisitUnsafe(auth, request).catch(() => undefined));
  } catch {
    // Recording is best effort by design; see the header comment.
  }
}

/**
 * A failed re-authentication: the one failed password check a server sees.
 * Never records the password or anything typed; only that it failed.
 */
export async function recordReauthFailed(auth: Authenticated, request: Request): Promise<void> {
  try {
    await withDeadline(
      insertEvent(
        kindOf(auth),
        auth.principal.id,
        'reauth_failed',
        deviceLabel(request.headers.get('user-agent')),
      ).catch(() => undefined),
    );
  } catch {
    // Best effort, as above.
  }
}
