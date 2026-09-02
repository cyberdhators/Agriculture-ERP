'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/**
 * Reports React rendering errors in the browser.
 *
 * Without this file the client SDK never sees a render error, so half of
 * "server and client" error reporting would be missing. The event goes through
 * the same scrubber as every other event.
 *
 * The text is fixed and carries no detail: it is shown to whoever is holding
 * the phone, and CONVENTIONS.md section 5.4 applies the same reasoning to the
 * API's 500.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <h1>Something went wrong</h1>
        <p>Please try again.</p>
      </body>
    </html>
  );
}
