import { ERROR_CODES, ERROR_MESSAGES } from '@agri-erp/shared';
import { describe, expect, it } from 'vitest';

import { DELETE, GET, PATCH, POST, PUT } from '../app/api/%5Fdev/validate-phone/route';

/**
 * Tests for the throwaway route that proves CONVENTIONS.md and packages/shared
 * agree. Deleted in B3 with the route.
 *
 * Phone numbers are FABRICATED.
 */

interface ErrorShape {
  error: { code: string; message: string; fields?: Record<string, string> };
}

const postRaw = async (rawBody: string, headers: Record<string, string> = {}) => {
  const response = await POST(
    new Request('http://localhost/api/_dev/validate-phone', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: rawBody,
    }),
  );
  return { status: response.status, body: (await response.json()) as unknown };
};

const postJson = (body: unknown) => postRaw(JSON.stringify(body));

const postWithContentType = async (contentType: string | null) => {
  const headers: Record<string, string> = {};
  if (contentType !== null) headers['content-type'] = contentType;
  const response = await POST(
    new Request('http://localhost/api/_dev/validate-phone', {
      method: 'POST',
      headers,
      body: JSON.stringify({ phone: '0912345678' }),
    }),
  );
  return { status: response.status, body: (await response.json()) as ErrorShape };
};

describe('checking a phone number through the running server', () => {
  it('returns the number in international form when it is valid', async () => {
    const { status, body } = await postJson({ phone: '0912345678' });

    expect(status).toBe(200);
    expect(body).toEqual({ data: { phone: '+211912345678' } });
  });

  it('tidies a number written with spaces before returning it', async () => {
    const { status, body } = await postJson({ phone: '+211 91 234 5678' });

    expect(status).toBe(200);
    expect(body).toEqual({ data: { phone: '+211912345678' } });
  });

  it('refuses a number containing letters and says which field was wrong', async () => {
    const { status, body } = await postJson({ phone: 'ring me later' });
    const error = body as ErrorShape;

    expect(status).toBe(400);
    expect(error.error.code).toBe(ERROR_CODES.invalidInput);
    expect(Object.keys(error.error.fields ?? {})).toEqual(['phone']);
  });

  it('refuses a form with nothing filled in, rather than failing', async () => {
    const { status, body } = await postJson({});
    const error = body as ErrorShape;

    expect(status).toBe(400);
    expect(error.error.code).toBe(ERROR_CODES.invalidInput);
    expect(Object.keys(error.error.fields ?? {})).toEqual(['phone']);
  });

  it('refuses a completely empty request, rather than failing', async () => {
    const { status, body } = await postRaw('');
    const error = body as ErrorShape;

    expect(status).toBe(400);
    expect(error.error.code).toBe(ERROR_CODES.invalidJson);
    expect(error.error.message).toBe(ERROR_MESSAGES.invalidJson);
    expect('fields' in error.error).toBe(false);
  });

  it('refuses a request that is not a form at all, rather than failing', async () => {
    const { status, body } = await postRaw('this is not a form');
    const error = body as ErrorShape;

    expect(status).toBe(400);
    expect(error.error.code).toBe(ERROR_CODES.invalidJson);
  });

  it('refuses a request carrying a field it does not recognise', async () => {
    const { status, body } = await postJson({ phone: '0912345678', nickname: 'Bibi' });
    const error = body as ErrorShape;

    expect(status).toBe(400);
    expect(error.error.fields).toEqual({ nickname: ERROR_MESSAGES.unknownField });
  });

  it('refuses a request that is too large to accept', async () => {
    const { status, body } = await postRaw(JSON.stringify({ phone: '0912345678' }), {
      'content-length': String(2 * 1024 * 1024),
    });
    const error = body as ErrorShape;

    expect(status).toBe(413);
    expect(error.error.code).toBe(ERROR_CODES.payloadTooLarge);
  });

  it('never reveals anything internal in a failure message', async () => {
    const { body } = await postRaw('not a form');
    const error = body as ErrorShape;

    expect(error.error.message).not.toMatch(/SyntaxError|JSON\.parse|at Object|\.ts:/);
  });
});

describe('using the wrong kind of request', () => {
  it.each([
    ['GET', GET],
    ['PUT', PUT],
    ['PATCH', PATCH],
    ['DELETE', DELETE],
  ])(
    'refuses a %s request in the documented shape rather than with a blank reply',
    async (_name, handler) => {
      const response = handler();
      const error = (await response.json()) as ErrorShape;

      expect(response.status).toBe(405);
      expect(error.error.code).toBe(ERROR_CODES.methodNotAllowed);
      expect(error.error.message).toBe(ERROR_MESSAGES.methodNotAllowed);
    },
  );
});

describe('saying what kind of request is being sent', () => {
  it('accepts a request that says it is JSON', async () => {
    const { status } = await postWithContentType('application/json');
    expect(status).toBe(200);
  });

  it('accepts a request that also states the character set', async () => {
    const { status } = await postWithContentType('application/json; charset=utf-8');
    expect(status).toBe(200);
  });

  it('accepts the type written in capitals', async () => {
    const { status } = await postWithContentType('APPLICATION/JSON');
    expect(status).toBe(200);
  });

  it('refuses a request that says it is a web form', async () => {
    const { status, body } = await postWithContentType('application/x-www-form-urlencoded');

    expect(status).toBe(415);
    expect(body.error.code).toBe(ERROR_CODES.unsupportedMediaType);
    expect(body.error.message).toBe('Send the request as application/json.');
  });

  it('refuses a request that says it is plain writing', async () => {
    const { status, body } = await postWithContentType('text/plain');

    expect(status).toBe(415);
    expect(body.error.code).toBe(ERROR_CODES.unsupportedMediaType);
  });

  it('refuses a request that does not say what it is at all', async () => {
    const { status, body } = await postWithContentType(null);

    expect(status).toBe(415);
    expect(body.error.code).toBe(ERROR_CODES.unsupportedMediaType);
  });

  it('complains about the kind of request before complaining about its contents', async () => {
    // A request wrong in two ways fails the same way every time.
    const response = await POST(
      new Request('http://localhost/api/_dev/validate-phone', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'not a form at all',
      }),
    );

    expect(response.status).toBe(415);
  });
});
