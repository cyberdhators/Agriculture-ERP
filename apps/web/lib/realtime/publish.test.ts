import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { RealtimeConfig } from './config';
import { realtimeConfig, realtimeProblems } from './config';
import { cleanPayload, groupEvents, publishRealtime, type RealtimeEvent } from './publish';

const CONFIG: RealtimeConfig = {
  appId: 'rap_test',
  key: 'public-key',
  secret: 'not-a-real-secret',
  apiKey: 'test-api-key',
  region: 'eu1',
};

const event = (channel: string, id = 'n1'): RealtimeEvent => ({
  event: 'notification.created',
  channels: [channel],
  data: { notification_id: id, kind: 'update', notice: 'message_listing' },
});

describe('publishing never gets in the request’s way', () => {
  it('does nothing without configuration', async () => {
    let calls = 0;
    const n = await publishRealtime([event('private-acct-x')], {
      config: null,
      send: async () => {
        calls += 1;
      },
    });
    expect(n).toBe(0);
    expect(calls).toBe(0);
  });

  it('a failing provider does not throw', async () => {
    await expect(
      publishRealtime([event('a')], {
        config: CONFIG,
        send: async () => {
          throw new Error('Bird is down');
        },
      }),
    ).resolves.toBe(0);
  });

  it('a synchronous throw does not escape either', async () => {
    await expect(
      publishRealtime([event('a')], {
        config: CONFIG,
        send: () => {
          throw new Error('boom');
        },
      }),
    ).resolves.toBe(0);
  });

  it('a hanging provider is given up on at the deadline', async () => {
    const started = Date.now();
    const n = await publishRealtime([event('a')], {
      config: CONFIG,
      deadlineMs: 50,
      send: () => new Promise(() => undefined),
    });
    expect(n).toBe(0);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe('payloads', () => {
  it('keep only the id fields, so text cannot ride an event', () => {
    expect(
      cleanPayload({
        notification_id: 'n1',
        title: 'secret title',
        body: 'a private message',
        text: 'x',
        phone: '+211900000000',
        sender: 'u1',
        kind: 'update',
      }),
    ).toEqual({ notification_id: 'n1', sender: 'u1', kind: 'update' });
  });

  it('drop non-string values', () => {
    expect(cleanPayload({ notification_id: 5, kind: { a: 1 } })).toEqual({});
  });

  it('one payload to many channels is one publish; different payloads stay apart', () => {
    const grouped = groupEvents([event('a'), event('b'), event('a'), event('c', 'n2')]);
    expect(grouped).toHaveLength(2);
    expect(grouped[0]!.channels).toEqual(['a', 'b']);
  });

  it('splits at Bird’s hundred-channel limit', () => {
    const many = Array.from({ length: 150 }, (_, i) => event(`c${i}`));
    expect(groupEvents(many).map((g) => g.channels.length)).toEqual([100, 50]);
  });
});

describe('configuration', () => {
  it('names what is missing, never values', () => {
    expect(realtimeProblems({})).toEqual([
      'BIRD_REALTIME_APP_ID',
      'NEXT_PUBLIC_BIRD_REALTIME_KEY',
      'BIRD_REALTIME_SECRET',
      'BIRD_REALTIME_API_KEY',
      'BIRD_REALTIME_REGION',
    ]);
  });

  it('reads the region from the API key when it is not stated', () => {
    const c = realtimeConfig({
      BIRD_REALTIME_APP_ID: 'rap_x',
      NEXT_PUBLIC_BIRD_REALTIME_KEY: 'k',
      BIRD_REALTIME_SECRET: 's',
      BIRD_API_KEY: ['bk', 'eu1', 'x'].join('_'),
    });
    expect(c?.region).toBe('eu1');
  });
});

describe('channel signing (2026-11-01 live test)', () => {
  it('builds the signing client WITH an API key -- the SDK throws without one', () => {
    // Observed in production: every /api/realtime/auth answered 500 with
    // "Configure `apiKey` for API calls", so no private channel subscribed.
    const src = readFileSync(fileURLToPath(new URL('./publish.ts', import.meta.url)), 'utf8');
    const sign = src.slice(src.indexOf('export async function signChannel'));
    expect(sign).toMatch(/new BirdClient\(\{\s*apiKey,\s*realtime: signing\s*\}\)/);
  });
});
