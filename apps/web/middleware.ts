import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { HOME_PATH, isPortalPath, LOGIN_PATH } from '@/lib/auth/paths';

/**
 * Two jobs, on portal paths and the login page only.
 *
 * 1. Refresh the session. Supabase access tokens expire after an hour; the
 *    server client refreshes them here and writes the renewed cookie back, so
 *    a staff member is not signed out mid-shift. getUser() validates the token
 *    against Supabase Auth rather than trusting the cookie's contents.
 * 2. Gate the portal. No session on a portal path redirects to /login with the
 *    intended page carried in ?next=; a session on /login goes to the home
 *    page. The API routes are not matched: they enforce their own roles.
 *
 * Fails closed: if the Supabase variables are missing, portal paths return
 * 503 rather than rendering screens nobody can be signed in to.
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    if (isPortalPath(pathname)) {
      return new NextResponse('Sign-in is not configured on this deployment.', { status: 503 });
    }
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && isPortalPath(pathname)) {
    const to = request.nextUrl.clone();
    to.pathname = LOGIN_PATH;
    to.search = '';
    to.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(to);
  }

  if (user && pathname === LOGIN_PATH) {
    const to = request.nextUrl.clone();
    to.pathname = HOME_PATH;
    to.search = '';
    return NextResponse.redirect(to);
  }

  return response;
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/farmers/:path*',
    '/desk/:path*',
    '/visits/:path*',
    '/admin/:path*',
    '/directories/:path*',
    '/library/:path*',
    '/design/:path*',
    '/login',
  ],
};
