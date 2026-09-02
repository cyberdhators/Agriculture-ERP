import * as Sentry from '@sentry/nextjs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { sharedOptions } from '../sentry.shared';

/**
 * WHAT ACTUALLY LEAVES THE PROCESS.
 *
 * Every other test in this unit checks the scrubber as a function. This one
 * checks the bytes: it installs a transport in place of the network, makes
 * Sentry report an error, and asserts against the envelope the SDK handed over
 * to be transmitted. If personal data survives anywhere in the pipeline --
 * beforeSend not wired, an integration adding data afterwards, a field nobody
 * thought of -- it shows up here and nowhere else.
 *
 * Every value below is FABRICATED.
 */

/** A farmer registration body of the shape B2 will accept. Fabricated. */
const REGISTRATION_BODY = {
  given_name: 'Achol',
  family_name: 'Deng',
  phone: '+211912345678',
  alt_phone: '0987654321',
  national_id: 'SSD-1234567',
  email: 'achol.deng@example.org',
  farm: { area: 2.5, contact: { name: 'Achol Deng', phone: '+211912345678' } },
  plots: [{ name: 'North plot', supervisor: { given_name: 'Deng' } }],
};

/** Anything from the body that must never appear in transmitted bytes. */
const MUST_NOT_APPEAR = [
  'Achol',
  'Deng',
  '912345678',
  '987654321',
  'SSD-1234567',
  'achol.deng@example.org',
];

let sent: unknown[] = [];

// Initialised once. Closing the client between tests leaves it closed, so
// later tests transmit nothing and every "no personal data" assertion passes
// against an empty payload -- see assertTransmitted below.
beforeAll(() => {
  Sentry.init({
    ...sharedOptions,
    dsn: 'https://examplePublicKey@o0.ingest.sentry.io/0',
    enabled: true,
    // Stands in for the network. Captures exactly what would have been sent.
    transport: () => ({
      send: async (envelope: unknown) => {
        sent.push(envelope);
        return {};
      },
      flush: async () => true,
    }),
  });
});

beforeEach(() => {
  sent = [];
});

/** Everything the SDK handed to the transport, as one string. */
const transmitted = (): string => JSON.stringify(sent);

/**
 * Asserts that something was transmitted, and that none of it was personal.
 *
 * The first half matters as much as the second. An assertion that personal
 * data is absent passes perfectly when nothing is sent at all, which is how
 * four of these tests passed while transmitting an empty payload. A guard
 * tested in one direction only is not a guard -- docs/PROJECT-STATE.md.
 */
const assertTransmitted = (): void => {
  expect(sent.length, 'nothing was transmitted, so this test proves nothing').toBeGreaterThan(0);
  for (const secret of MUST_NOT_APPEAR) {
    expect(transmitted(), `"${secret}" reached the transport`).not.toContain(secret);
  }
};

describe('what reaches Sentry when a route handler fails holding a farmer registration', () => {
  it('sends the error at all, so this test cannot pass by sending nothing', async () => {
    Sentry.captureException(new Error('a plain failure with no personal data'));
    await Sentry.flush(2000);

    expect(sent.length).toBeGreaterThan(0);
    expect(transmitted()).toContain('a plain failure with no personal data');
  });

  it('sends no part of a registration body attached as request data', async () => {
    Sentry.withScope((scope) => {
      scope.setContext('request', {
        url: 'https://example.org/api/farmers?phone=%2B211912345678',
        query_string: 'phone=%2B211912345678',
        data: REGISTRATION_BODY,
      });
      Sentry.captureException(new Error('insert failed'));
    });
    await Sentry.flush(2000);

    assertTransmitted();
  });

  it('sends no part of a registration body attached as extra context', async () => {
    Sentry.withScope((scope) => {
      scope.setExtra('submitted', REGISTRATION_BODY);
      Sentry.captureException(new Error('validation blew up'));
    });
    await Sentry.flush(2000);

    assertTransmitted();
  });

  it('sends no part of a registration body recorded in a breadcrumb', async () => {
    Sentry.addBreadcrumb({
      category: 'http',
      message: `POST /api/farmers ${REGISTRATION_BODY.phone}`,
      data: { body: REGISTRATION_BODY },
    });
    Sentry.captureException(new Error('failed after the breadcrumb'));
    await Sentry.flush(2000);

    assertTransmitted();
  });

  it('sends no phone number written into the error message itself', async () => {
    Sentry.captureException(
      new Error('could not register on +211912345678: that number is already used'),
    );
    await Sentry.flush(2000);

    expect(sent.length).toBeGreaterThan(0);
    expect(transmitted()).not.toContain('912345678');
  });

  it('sends no source code from around the place the error was thrown', async () => {
    // ContextLines attaches the surrounding source lines verbatim, which the
    // scrubber cannot judge because they are code rather than data. It is
    // turned off in sentry.shared.ts. This proves it stayed off.
    Sentry.captureException(new Error('a failure with source nearby'));
    await Sentry.flush(2000);

    expect(sent.length).toBeGreaterThan(0);
    // The KEYS may legitimately appear -- disabling Sentry's ContextLines
    // integration is not enough, because something else in the Next.js error
    // path fills them in. What must never appear is their CONTENT, which the
    // scrubber replaces at the last gate.
    const text = transmitted();
    expect(text).not.toMatch(/"context_line":"(?!\[redacted\])/);
    expect(text).not.toMatch(/"pre_context":\[(?!\s*\])/);
    expect(text).not.toMatch(/"post_context":\[(?!\s*\])/);
  });

  it('KNOWN LIMIT: a name or national id written into free text is not removed', async () => {
    // Not a defect -- a stated limit of the agreed rules. The scrubber removes
    // values under named keys and strings shaped like a South Sudan number.
    // Nothing distinguishes a person's name from any other word in a sentence,
    // so a name an author writes into an error message survives.
    //
    // The protection is that our own messages never interpolate personal data:
    // CONVENTIONS.md section 5.4 fixes the 500 sentence for the same reason.
    // This test exists so the limit is visible rather than assumed away.
    Sentry.captureException(new Error('could not register Achol Deng, id SSD-1234567'));
    await Sentry.flush(2000);

    expect(sent.length).toBeGreaterThan(0);
    const text = transmitted();
    expect(text).toContain('Achol');
    // A national ID is the worse case: not a listed key when written in free
    // text, not phone-shaped, and the one identifier a farmer cannot change
    // after it leaks. See the standing rule in docs/PROJECT-STATE.md.
    expect(text).toContain('SSD-1234567');
  });

  it('sends no part of a registration body held as a tag', async () => {
    Sentry.withScope((scope) => {
      scope.setTag('caller', REGISTRATION_BODY.phone);
      Sentry.captureException(new Error('tagged failure'));
    });
    await Sentry.flush(2000);

    assertTransmitted();
  });

  it('still says which environment and version the failure came from', async () => {
    Sentry.captureException(new Error('a plain failure'));
    await Sentry.flush(2000);

    expect(sent.length).toBeGreaterThan(0);
    const text = transmitted();
    expect(text).toContain('environment');
    expect(text).toContain('app_version');
  });

  it('sends no transaction, whatever else happens', async () => {
    await Sentry.startSpan({ name: 'a span nobody asked for' }, async () => {
      await Promise.resolve();
    });
    await Sentry.flush(2000);

    Sentry.captureException(new Error('after the span'));
    await Sentry.flush(2000);

    expect(sent.length).toBeGreaterThan(0);
    expect(transmitted()).not.toContain('"type":"transaction"');
  });

  it('sends no machine hostname, which on a laptop is often a person s name', async () => {
    Sentry.captureException(new Error('a plain failure'));
    await Sentry.flush(2000);

    expect(sent.length).toBeGreaterThan(0);
    const text = transmitted();
    expect(text).toContain('"server_name":"development"');
    expect(text).not.toMatch(/MacBook|iMac|\.local/);
  });

  it('KNOWN LIMIT: the SDK writes its own name in after the scrubber has run', async () => {
    // The rule to redact every key called `name` is applied to everything the
    // scrubber can reach. Sentry attaches sdk.name during envelope assembly,
    // which happens after beforeSend, so that one field survives. Its value is
    // the constant "sentry.javascript.nextjs" and carries nothing personal.
    // Recorded so the rule is not believed to be wider than it is.
    Sentry.captureException(new Error('a plain failure'));
    await Sentry.flush(2000);

    expect(transmitted()).toContain('sentry.javascript.nextjs');
  });
});
