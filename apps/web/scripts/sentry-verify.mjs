// Sends ONE deliberate error to Sentry so a human can read what arrives.
//
//   pnpm sentry:verify        (root script; runs this from apps/web, where the SDK resolves)
//
// WHY THIS EXISTS. B1.5 proved the scrubber against captured envelopes and
// proved the SDK transmits -- against a listener we controlled. Nobody has yet
// confirmed an event ARRIVES in Sentry, or read one there. The shape recorded
// in docs/PROJECT-STATE.md is a prediction until someone looks. This turns it
// into an observation.
//
// It loads the SAME options the application uses (apps/web/sentry.shared.ts):
// same scrubber, same tags, same disabled integrations. What it proves is the
// pipeline from our code to Sentry's servers. What it does NOT prove is that a
// route failure reports -- that is the wrapper's job, covered by
// apps/web/tests/wrapper-reports-errors.test.ts.
//
// The error carries FABRICATED personal data on purpose, so the reader can
// confirm what the scrubber removed and -- just as important -- what it is
// known not to remove (a name in free text, a national id in free text).

// The `default` export, not the namespace. Under plain Node, `@sentry/nextjs`
// resolves to a CommonJS build, and an ESM namespace import of CommonJS only
// carries the names Node can detect statically -- `init` is one; the
// re-exported `captureException`, `addBreadcrumb`, `flush` are not. `default`
// is the whole module.exports. Two dry-runs of this script crashed on exactly
// that before it was understood.
import console from 'node:console';
import process from 'node:process';

import * as SentryNamespace from '@sentry/nextjs';

const Sentry = SentryNamespace.default ?? SentryNamespace;

import { loadEnvLocal } from '../../../scripts/load-env.mjs';

loadEnvLocal();

if (!process.env.NEXT_PUBLIC_SENTRY_DSN) {
  console.error('NEXT_PUBLIC_SENTRY_DSN is not set in .env.local. Nothing was sent.');
  process.exit(1);
}

const { sharedOptions } = await import('../sentry.shared.ts');

// Everything below is fabricated. No value belongs to a real person.
const FABRICATED = {
  given_name: 'Achol',
  family_name: 'Deng',
  phone: '+211912345678',
  national_id: 'SSD-1234567',
};

Sentry.init({ ...sharedOptions, enabled: true });

// The context-object form of captureException, not withScope: under plain
// Node's resolution of @sentry/nextjs, withScope is not on the namespace, and
// the first dry-run of this script reported its own crash to Sentry -- which,
// incidentally, proved the uncaught-exception path works, scrubbed and tagged.
if (typeof Sentry.addBreadcrumb === 'function') {
  // In a breadcrumb -- listed keys, plus a phone in free text.
  Sentry.addBreadcrumb({
    category: 'verification',
    message: `submitting registration for ${FABRICATED.phone}`,
    data: { body: FABRICATED },
  });
}

Sentry.captureException(
  // In the MESSAGE, as free text. The phone should go; the name and the
  // national id are the KNOWN LIMIT and are expected to arrive intact.
  new Error(
    `B1.5 verification: deliberate test error for Achol Deng, ${FABRICATED.phone}, id SSD-1234567`,
  ),
  {
    tags: { verification: 'b1-5-sentry-verify' },
    // Under LISTED KEYS -- the scrubber should remove every one of these.
    extra: { registration_body: FABRICATED },
    contexts: {
      request: {
        url: 'https://example.invalid/api/farmers?phone=%2B211912345678',
        query_string: 'phone=%2B211912345678',
        data: FABRICATED,
      },
    },
  },
);

const flushed = await Sentry.flush(10_000);
console.log(
  flushed
    ? 'Sent. Open Sentry and read the event.'
    : 'Flush timed out; the event may not have left.',
);
console.log(
  'Environment tag:',
  sharedOptions.environment,
  ' app_version tag:',
  sharedOptions.release,
);
await Sentry.close(2_000);
