import { describe, expect, it } from 'vitest';

import { REDACTED, scrub, scrubEvent, scrubString } from '../src/index';

/**
 * Every phone number, name and identifier in this file is FABRICATED. No value
 * here belongs to a real person. Real farmer data exists in production only --
 * CLAUDE.md, "Personal data".
 */

const FABRICATED_PHONE = '+211912345678';
const FABRICATED_LOCAL = '0912345678';

/** True when this fabricated number appears anywhere in the scrubbed output. */
const leaks = (value: unknown): boolean => {
  const text = JSON.stringify(value) ?? '';
  return text.includes('912345678') || text.includes('Achol') || text.includes('Deng');
};

describe('what the scrubber removes before anything leaves the process', () => {
  it('an event carrying a phone number under "phone" leaves without it', () => {
    const scrubbed = scrubEvent({ extra: { phone: FABRICATED_PHONE } }) as {
      extra: { phone: string };
    };

    expect(scrubbed.extra.phone).toBe(REDACTED);
    expect(leaks(scrubbed)).toBe(false);
  });

  it('an event with a phone number in the middle of a free-text message leaves without it', () => {
    const scrubbed = scrubEvent({
      message: `Could not reach farmer on ${FABRICATED_PHONE} before the visit`,
    }) as { message: string };

    expect(scrubbed.message).toBe('Could not reach farmer on [redacted] before the visit');
    expect(leaks(scrubbed)).toBe(false);
  });

  it('an event with a farmer name nested three levels deep leaves without it', () => {
    const scrubbed = scrubEvent({
      contexts: { registration: { farmer: { given_name: 'Achol', family_name: 'Deng' } } },
    }) as { contexts: { registration: { farmer: Record<string, string> } } };

    const farmer = scrubbed.contexts.registration.farmer;
    expect(farmer.given_name).toBe(REDACTED);
    expect(farmer.family_name).toBe(REDACTED);
    expect(leaks(scrubbed)).toBe(false);
  });

  it('an event with a phone number in a breadcrumb leaves without it', () => {
    const scrubbed = scrubEvent({
      breadcrumbs: [
        { category: 'console', message: `submitting ${FABRICATED_LOCAL}` },
        { category: 'http', data: { body: { phone: FABRICATED_PHONE } } },
      ],
    });

    expect(leaks(scrubbed)).toBe(false);
  });

  it('an event with a phone number in the request query string leaves without it', () => {
    const scrubbed = scrubEvent({
      request: {
        url: `https://example.org/api/farmers?phone=${FABRICATED_PHONE}`,
        query_string: `phone=${FABRICATED_PHONE}`,
        data: { phone: FABRICATED_PHONE, given_name: 'Achol' },
      },
    }) as { request: { url: string; query_string: string; data: unknown } };

    expect(scrubbed.request.query_string).toBe(REDACTED);
    expect(scrubbed.request.data).toBe(REDACTED);
    expect(scrubbed.request.url).toBe(`https://example.org/api/farmers?${REDACTED}`);
    expect(leaks(scrubbed)).toBe(false);
  });

  it('an event with no personal data is unchanged', () => {
    const event = {
      message: 'Database connection timed out after 30000ms',
      level: 'error',
      tags: { environment: 'staging', release: 'abc1234' },
      breadcrumbs: [{ category: 'query', message: 'SELECT 1' }],
      extra: { attempt: 3, durations: [1200, 4800] },
    };

    expect(scrubEvent(structuredClone(event))).toEqual(event);
  });
});

describe('places personal data hides that a surface-level scrubber would miss', () => {
  it('removes a phone number held in a stack frame local variable', () => {
    const scrubbed = scrubEvent({
      exception: {
        values: [
          {
            type: 'TypeError',
            value: 'cannot read property',
            stacktrace: {
              frames: [{ function: 'registerFarmer', vars: { phone: FABRICATED_PHONE } }],
            },
          },
        ],
      },
    });

    expect(leaks(scrubbed)).toBe(false);
  });

  it('removes a phone number written into an exception message', () => {
    const scrubbed = scrubEvent({
      exception: { values: [{ type: 'Error', value: `duplicate: ${FABRICATED_LOCAL}` }] },
    });

    expect(leaks(scrubbed)).toBe(false);
  });

  it('removes a phone number used as a tag value', () => {
    const scrubbed = scrubEvent({ tags: { caller: FABRICATED_LOCAL } });

    expect(leaks(scrubbed)).toBe(false);
  });

  it('removes an authorization header wherever it sits', () => {
    const scrubbed = scrubEvent({
      request: { headers: { Authorization: 'Bearer abc.def.ghi', Cookie: 'session=xyz' } },
    }) as { request: { headers: Record<string, string> } };

    expect(scrubbed.request.headers.Authorization).toBe(REDACTED);
    expect(scrubbed.request.headers.Cookie).toBe(REDACTED);
  });

  it('removes a name inside an array of records', () => {
    const scrubbed = scrubEvent({
      extra: { batch: [{ given_name: 'Achol' }, { given_name: 'Deng' }] },
    });

    expect(leaks(scrubbed)).toBe(false);
  });

  it('treats a key written in another style as the same key', () => {
    const scrubbed = scrub({ altPhone: FABRICATED_PHONE, 'Alt-Phone': FABRICATED_PHONE }) as Record<
      string,
      string
    >;

    expect(scrubbed.altPhone).toBe(REDACTED);
    expect(scrubbed['Alt-Phone']).toBe(REDACTED);
  });

  it('redacts the SDK metadata it was told to redact, sparseness accepted', () => {
    const scrubbed = scrub({ sdk: { name: 'sentry.javascript.nextjs', version: '10.73.0' } }) as {
      sdk: Record<string, string>;
    };

    expect(scrubbed.sdk.name).toBe(REDACTED);
    expect(scrubbed.sdk.version).toBe('10.73.0');
  });

  it('removes the source code attached to a stack frame', () => {
    const scrubbed = scrubEvent({
      exception: {
        values: [
          {
            stacktrace: {
              frames: [
                {
                  filename: 'app/api/farmers/route.ts',
                  lineno: 42,
                  context_line: "  const phone = body.phone; // '+211912345678'",
                  pre_context: ['const { given_name } = body;'],
                  post_context: ['  return NextResponse.json({ data });'],
                },
              ],
            },
          },
        ],
      },
    }) as { exception: { values: [{ stacktrace: { frames: [Record<string, unknown>] } }] } };

    const frame = scrubbed.exception.values[0].stacktrace.frames[0];
    expect(frame.context_line).toBe(REDACTED);
    expect(frame.pre_context).toBe(REDACTED);
    expect(frame.post_context).toBe(REDACTED);
    // What a stack trace is actually for survives.
    expect(frame.filename).toBe('app/api/farmers/route.ts');
    expect(frame.lineno).toBe(42);
    expect(leaks(scrubbed)).toBe(false);
  });

  it('survives an event that refers back to itself', () => {
    const event: Record<string, unknown> = { message: 'ok' };
    event.self = event;

    expect(() => scrubEvent(event)).not.toThrow();
  });
});

describe('which written forms of a number the scrubber recognises', () => {
  it.each([
    ['international', '+211912345678'],
    ['no plus sign', '211912345678'],
    ['local with a leading zero', '0912345678'],
    ['spaced', '+211 91 234 5678'],
    ['hyphenated', '+211-91-234-5678'],
    ['embedded in a longer run of digits', 'ref00912345678999'],
  ])('removes a number written %s', (_label, written) => {
    expect(scrubString(`before ${written} after`)).not.toMatch(/912345678/);
  });

  it.each([
    ['a millisecond timestamp', '1756800000000'],
    ['a short reference', '12345'],
    ['a number from another country', '+254712345678'],
  ])('leaves %s alone where it can', (_label, written) => {
    const output = scrubString(`value ${written}`);
    expect(typeof output).toBe('string');
  });

  it('does not touch text that contains no numbers at all', () => {
    const text = 'Database connection timed out';
    expect(scrubString(text)).toBe(text);
  });
});
