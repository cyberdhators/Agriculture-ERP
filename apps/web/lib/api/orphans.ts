import { prisma } from '../db';
import { listAuthAccountIds } from '../supabase/admin';

/**
 * Authentication accounts with no application row.
 *
 * True atomicity across Supabase Auth and Postgres is not achievable: Auth is a
 * separate service over HTTP and a database transaction cannot roll back an
 * HTTP call. Creation is a compensating transaction — make the account, make
 * the row, and delete the account if the row fails.
 *
 * If the compensating delete ALSO fails, an orphan remains. It fails closed:
 * the account can authenticate, requireRole finds no row, and it gets 401. But
 * it exists, and the administrator list reports the count rather than
 * pretending it cannot happen. See docs/DECISIONS.md.
 */
export async function countOrphanAuthAccounts(): Promise<number> {
  const [authIds, rows] = await Promise.all([
    listAuthAccountIds(),
    prisma.$queryRawUnsafe<{ auth_user_id: string }[]>(
      'SELECT auth_user_id FROM public."user" UNION ALL SELECT auth_user_id FROM public.officer',
    ),
  ]);
  const known = new Set(rows.map((r) => r.auth_user_id));
  return authIds.filter((id) => !known.has(id)).length;
}
