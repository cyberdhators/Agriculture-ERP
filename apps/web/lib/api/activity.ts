import { type AccessPrincipalKind, shouldTouchActivity } from '@agri-erp/shared';

import { prisma } from '../db';
import { type Authenticated } from './require-role';

/**
 * LAST ACTIVITY ON API CALLS (2026-10-28, lane-security). The specification's
 * access records include "last activity"; until now it moved only when a
 * screen called GET /api/me, so a staff member working in one screen for an
 * hour looked idle.
 *
 * THROTTLED TWICE. In memory, per server instance: one write per account per
 * ACTIVITY_TOUCH_INTERVAL_MS (five minutes). And in the statement itself: the
 * row moves only if it is older than that, so many instances together still
 * write about once per five minutes per account.
 *
 * UPDATE ONLY. An account with no activity row yet is left alone: the first
 * row is written by the "me" visit (lib/api/access-log.ts), which is what
 * decides first sign-in. Creating it here would make that visit look like a
 * return to an existing account.
 *
 * Moving last_seen_at here also means a "return session" is now measured from
 * the last API call rather than the last page load, which is the truer
 * reading of "a return while still authenticated".
 *
 * NEVER THROWS, never waits more than ACTIVITY_DEADLINE_MS, never changes the
 * route's answer.
 */

export const ACTIVITY_DEADLINE_MS = 1_000;

/** Bounded so a long-lived instance cannot grow it without end. */
const MAX_TRACKED = 5_000;
const lastTouched = new Map<string, number>();

export async function touchActivity(auth: Authenticated, nowMs = Date.now()): Promise<void> {
  const kind: AccessPrincipalKind = auth.principal.kind;
  const key = `${kind}:${auth.principal.id}`;
  if (!shouldTouchActivity(lastTouched.get(key), nowMs)) return;
  if (lastTouched.size >= MAX_TRACKED) lastTouched.clear();
  lastTouched.set(key, nowMs);

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      prisma
        .$executeRawUnsafe(
          `UPDATE public.account_activity
              SET last_seen_at = now()
            WHERE principal_kind = $1 AND principal_id = $2::uuid
              AND last_seen_at < now() - interval '5 minutes'`,
          kind,
          auth.principal.id,
        )
        .catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ACTIVITY_DEADLINE_MS);
      }),
    ]);
  } catch {
    // Best effort by design.
  } finally {
    clearTimeout(timer);
  }
}
