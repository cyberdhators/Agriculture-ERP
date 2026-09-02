import * as Sentry from '@sentry/nextjs';

/**
 * Starts error reporting for whichever server runtime is booting.
 *
 * Next calls this once per runtime, before any request is handled.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

/**
 * Reports errors thrown inside server components and route handlers, which
 * Next catches itself and would otherwise not surface.
 */
export const onRequestError = Sentry.captureRequestError;
