/**
 * Which paths need a staff session. Route groups do not appear in URLs, so the
 * (portal) group is named here by its public prefixes. The farmer side and the
 * marketplace are not listed: they have no server principal yet and stay open.
 */
export const PORTAL_PREFIXES = [
  '/dashboard',
  '/farmers',
  '/desk',
  '/admin',
  '/directories',
  '/library',
  '/design',
] as const;

export const LOGIN_PATH = '/login';
export const HOME_PATH = '/dashboard';

export function isPortalPath(pathname: string): boolean {
  return PORTAL_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** A post-login target is honoured only if it is a same-origin path. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return HOME_PATH;
  return next;
}
