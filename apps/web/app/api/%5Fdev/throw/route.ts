import { NextResponse } from 'next/server';

/**
 * ============================================================================
 * THIS ROUTE IS DELETED IN B3. IT IS NOT A FEATURE.
 * ============================================================================
 *
 * It throws on purpose, so that error reporting can be proved end to end: an
 * error nobody caught reaching Sentry, with the environment and version tags
 * attached and the scrubber having run.
 *
 * It is UNAUTHENTICATED, under the single enumerated /api/_dev/* exception in
 * docs/api/CONVENTIONS.md section 2, and is listed in the outstanding items
 * section of docs/PROJECT-STATE.md.
 *
 * TWO DELIBERATE DIVERGENCES FROM CONVENTIONS.md, both recorded in
 * PROJECT-STATE.md and both dying with this route in B3:
 *
 *   1. It throws unhandled, so the framework answers, not us. The response is
 *      therefore NOT the documented error shape of section 4 and carries
 *      neither the fixed sentence of section 5.4 nor, necessarily, the JSON
 *      content type of section 3.1. Catching the error would produce a correct
 *      response and prove far less: it would test our own call to Sentry
 *      rather than Sentry's capture of an error nobody handled, which is the
 *      only thing worth proving here.
 *
 *   2. It throws before the section 9.1 Content-Type check. It reads no body,
 *      so there is nothing to check, and a 415 would defeat the purpose.
 *
 * It touches no database and stores nothing. The message below is fixed and
 * carries no data of any kind.
 */

export async function POST(): Promise<NextResponse> {
  throw new Error('B1.5 deliberate test error: error reporting is wired up correctly.');
}

/** So the route is visible without a body. Throws identically. */
export async function GET(): Promise<NextResponse> {
  throw new Error('B1.5 deliberate test error: error reporting is wired up correctly.');
}
