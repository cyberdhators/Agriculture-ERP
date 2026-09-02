import { scrubEvent } from '@agri-erp/shared';

/**
 * Options every Sentry runtime shares, so server, edge and browser cannot
 * disagree about what leaves the process.
 *
 * ERRORS ONLY. No performance tracing, no session replay, no profiling, no
 * release-health sessions. Each is turned off explicitly below rather than left
 * to a default, because defaults change between SDK versions and this one
 * decides whether personal data crosses a network boundary.
 */

/**
 * A Sentry DSN is a write-only ingest key. It has to reach the browser for
 * client-side errors to be reported at all, which is why it is NEXT_PUBLIC_.
 * It grants no read access to anything. See docs/PROJECT-STATE.md.
 */
export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? '';

/** staging, production, or development when nothing says otherwise. */
export const SENTRY_ENVIRONMENT =
  process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? 'development';

/** The commit the running code was built from. */
export const SENTRY_RELEASE =
  process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'unknown';

/**
 * Integrations that are turned off.
 *
 * The first group send something other than an error. The second group send
 * an error, but attach data we cannot guarantee is safe -- see the note on
 * ContextLines, which was found shipping source code during B1.5.
 */
const NOT_ERROR_REPORTING = new Set([
  'BrowserTracing', // performance tracing
  'BrowserSession', // release-health sessions
  'ProcessSession', // release-health sessions, server side
  'Replay', // session replay, in case a future default adds it
  'ReplayCanvas',
  'BrowserProfiling', // profiling, likewise
  'ProfilingIntegration',

  /**
   * ContextLines reads the source file around the throw site and attaches the
   * surrounding lines verbatim. Those lines are code, so the scrubber's rules
   * -- values under a named key, strings shaped like a phone number -- cannot
   * judge them: a literal, a field name or a comment near the failure travels
   * to Sentry exactly as written.
   *
   * Found during B1.5 by inspecting a real transmitted envelope, which
   * contained the source of the test that produced it. Off. The filename,
   * line and column survive, which is what a stack trace is actually for.
   */
  'ContextLines',
]);

export const sharedOptions = {
  dsn: SENTRY_DSN,

  /**
   * Nothing is sent unless a DSN is configured. Local machines and CI have no
   * DSN, so they report nothing rather than failing or sending somewhere.
   */
  enabled: SENTRY_DSN !== '',

  environment: SENTRY_ENVIRONMENT,
  release: SENTRY_RELEASE,

  /** Never attach IP addresses, cookies or user identifiers automatically. */
  sendDefaultPii: false,

  /**
   * Sentry defaults this to the machine's hostname. On a developer's laptop
   * that is often a person's name -- "<someone>s-MacBook-Air.local" -- which is
   * personal data leaving for a third party before any farmer record exists.
   * Found during B1.5 by reading a transmitted envelope. The environment name
   * is what we actually need in order to read an error report.
   */
  serverName: SENTRY_ENVIRONMENT,

  /** Errors only. */
  tracesSampleRate: 0,
  profilesSampleRate: 0,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  enableLogs: false,

  initialScope: {
    tags: {
      environment: SENTRY_ENVIRONMENT,
      app_version: SENTRY_RELEASE,
    },
  },

  integrations: (defaults: { name: string }[]) =>
    defaults.filter((integration) => !NOT_ERROR_REPORTING.has(integration.name)),

  /**
   * THE LAST GATE. Nothing reaches Sentry without passing through here.
   *
   * Applied to the whole event -- message, exception values, breadcrumbs,
   * request data, extra context and tags -- not just the top level.
   */
  beforeSend: <T>(event: T): T => scrubEvent(event),

  /** No transaction is ever sent, whatever else is configured. */
  beforeSendTransaction: () => null,
};
