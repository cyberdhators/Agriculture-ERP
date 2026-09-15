/**
 * Which paths need a staff session. Route groups do not appear in URLs, so the
 * (portal) group is named here by its public prefixes.
 *
 * The marketplace and the farmer side are public. The owner decided so on
 * 2026-09-15 (DECISIONS.md, "The marketplace stays visible"): the audit's
 * fixes are applied on top of a visible marketplace, not behind a gate.
 * NEXT_PUBLIC_MARKET_OPEN=0 closes both behind the staff session if that is
 * ever wanted; unset or anything else means open.
 */
export const PORTAL_PREFIXES = [
  '/dashboard',
  '/farmers',
  '/desk',
  '/visits',
  '/reports',
  '/admin',
  '/directories',
  '/library',
  '/design',
] as const;

/** Public unless the deployment closes them (NEXT_PUBLIC_MARKET_OPEN=0). */
export const MARKET_PREFIXES = ['/market', '/farmer'] as const;

/** Read at build time, like every NEXT_PUBLIC_ variable: change it, then redeploy. */
export const MARKET_OPEN = process.env.NEXT_PUBLIC_MARKET_OPEN !== '0';

export const LOGIN_PATH = '/login';
export const HOME_PATH = '/dashboard';

const under = (pathname: string, prefixes: readonly string[]): boolean =>
  prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export function isPortalPath(pathname: string, marketOpen: boolean = MARKET_OPEN): boolean {
  if (under(pathname, PORTAL_PREFIXES)) return true;
  return !marketOpen && under(pathname, MARKET_PREFIXES);
}

/** Where the site root sends a visitor: the marketplace when open, sign-in otherwise. */
export function frontDoor(marketOpen: boolean = MARKET_OPEN): string {
  return marketOpen ? '/market' : LOGIN_PATH;
}

/** A post-login target is honoured only if it is a same-origin path. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return HOME_PATH;
  return next;
}
