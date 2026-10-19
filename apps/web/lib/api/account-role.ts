import { type Role } from '@agri-erp/shared';

/**
 * ONE ACCOUNT, BUYING AND SELLING (2026-10-19). Which of an account's two
 * sides a route meets: the first of the route's own roles that the account
 * holds. Null when it holds none of them -- the route refuses. Pure, so the
 * rule is tested without a database (account-role.test.ts).
 */
export function accountSideFor(
  allowed: readonly Role[],
  holds: { buyer: boolean; farmer: boolean },
): 'buyer' | 'farmer' | null {
  for (const role of allowed) {
    if (role === 'buyer' && holds.buyer) return 'buyer';
    if (role === 'farmer' && holds.farmer) return 'farmer';
  }
  return null;
}
