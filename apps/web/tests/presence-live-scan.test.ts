import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ONLINE_CACHE_MS } from '../lib/realtime/publish';

/**
 * ONLINE STATUS, EXACT AND LIVE (2026-11-01), read as text. The pure rules
 * (lastSeenOf, presenceTickMs, shouldRecordBye) are tested in
 * packages/shared/tests/presence.test.ts; this holds the wiring.
 * docs/DECISIONS.md, "Online status: exact last seen, live in an open chat".
 */

const web = fileURLToPath(new URL('..', import.meta.url));
const root = fileURLToPath(new URL('../../..', import.meta.url));
const read = (path: string) => readFileSync(join(web, path), 'utf8');

describe('the bye: the moment the app was closed or hidden', () => {
  const route = read('app/api/account/presence/bye/route.ts');
  const activity = read('lib/api/activity.ts');

  it('is for a farmer or buyer session, with an empty body, for its own account only', () => {
    expect(route).toMatch(/roles: \[FARMER_ROLE, BUYER_ROLE\]/);
    expect(route).toMatch(/bodySchema: emptyBodySchema/);
    expect(route).toMatch(/recordPresenceBye\(auth\)/);
  });

  it('writes one time column, throttled in memory and in the statement to 30 seconds', () => {
    expect(activity).toMatch(/shouldRecordBye\(lastBye\.get\(key\), nowMs\)/);
    expect(activity).toMatch(/SET presence_seen_at = now\(\)/);
    expect(activity).toMatch(/presence_seen_at < now\(\) - interval '30 seconds'/);
  });

  it('the app sends it on pagehide and when hidden, as a beacon', () => {
    const client = read('lib/realtime/client.ts');
    expect(client).toMatch(/addEventListener\('pagehide', sayBye\)/);
    expect(client).toMatch(/visibilityState === 'hidden'\) sayBye\(\)/);
    expect(client).toMatch(/navigator\.sendBeacon\?\.\(BYE_URL/);
  });

  it('the migration is additive: one nullable column', () => {
    const sql = readFileSync(
      join(root, 'prisma/migrations/20261101100100_presence_seen/migration.sql'),
      'utf8',
    );
    expect(sql).toMatch(/ADD COLUMN "presence_seen_at" TIMESTAMPTZ;/);
    expect(sql).not.toMatch(/\bDROP\b|NOT NULL/);
  });
});

describe('what the other person reads', () => {
  const presence = read('lib/api/presence.ts');

  it('prefers the exact time through lastSeenOf, read so an unmigrated database still works', () => {
    expect(presence).toMatch(
      /lastSeenOf\(\{ presenceSeenAt: r\.exact_at, activitySeenAt: r\.at \}\)/,
    );
    expect(presence).toMatch(/to_jsonb\(a\) ->> 'presence_seen_at'/);
    expect(presence).toMatch(/exact: last\?\.exact \?\? false/);
  });

  it('still decides visibility by the reciprocal rule, on the server', () => {
    expect(presence).toMatch(/counterpartVisible\(\{/);
    // Nobody may join another account's presence channel: joining would
    // count the viewer as present there and reveal it to the client.
    const shared = readFileSync(join(root, 'packages/shared/src/realtime.ts'), 'utf8');
    expect(shared).toMatch(
      /channel\.kind === 'presence'\) return channel\.id === facts\.authUserId && facts\.showActivity/,
    );
  });

  it('the online cache is short enough for an open chat to flip within seconds', () => {
    expect(ONLINE_CACHE_MS).toBeLessThanOrEqual(3_000);
  });

  it('the label re-renders on a timer', () => {
    const line = read('components/live/Presence.tsx');
    expect(line).toMatch(/presenceTickMs\(label\)/);
    expect(line).toMatch(/setInterval\(\(\) => setNow\(Date\.now\(\)\), tick\)/);
  });
});
