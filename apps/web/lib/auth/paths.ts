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
  '/farms',
  '/desk',
  '/visits',
  '/reports',
  '/admin',
  '/communications',
  '/product-reports',
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

/**
 * B13. The buyer's side. Every page under it needs a session, except the
 * application form -- an applicant has no account until they submit it.
 * Which role the session belongs to is decided by the pages and, for data,
 * by every route: the middleware only knows signed-in from signed-out.
 */
export const BUYER_PREFIX = '/buyer';
export const BUYER_HOME_PATH = '/buyer/dashboard';
export const BUYER_REGISTER_PATH = '/buyer/register';

const under = (pathname: string, prefixes: readonly string[]): boolean =>
  prefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`));

export const isBuyerPath = (pathname: string): boolean => under(pathname, [BUYER_PREFIX]);

export function isPortalPath(pathname: string, marketOpen: boolean = MARKET_OPEN): boolean {
  if (under(pathname, PORTAL_PREFIXES)) return true;
  if (isBuyerPath(pathname)) return !under(pathname, [BUYER_REGISTER_PATH]);
  return !marketOpen && under(pathname, MARKET_PREFIXES);
}

/**
 * Where a signed-in principal belongs after sign-in. A buyer is sent to the
 * buyer side whatever `next` asked for, unless `next` is already there; staff
 * keep the `next` they were given. Both are only ever same-origin paths.
 */
export function homeFor(role: string | undefined, next: string): string {
  if (role === 'buyer') return isBuyerPath(next) ? next : BUYER_HOME_PATH;
  // B14: a farmer who signs in through the staff form still lands on their own side.
  if (role === 'farmer') return '/farmer/account';
  return isBuyerPath(next) ? HOME_PATH : next;
}

/** Where the site root sends a visitor: the marketplace when open, sign-in otherwise. */
export function frontDoor(marketOpen: boolean = MARKET_OPEN): string {
  return marketOpen ? '/market' : LOGIN_PATH;
}

/**
 * A post-login target is honoured only if it is a same-origin path.
 *
 * Backslashes are refused as well as `//`: some browsers normalise `\` to `/`,
 * so `/\evil.example` can become protocol-relative after the check has passed
 * it. Cheaper to refuse than to reason about per-browser normalisation.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return HOME_PATH;
  if (next.includes('\\')) return HOME_PATH;
  return next;
}
