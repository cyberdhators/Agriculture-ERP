import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { REALTIME_PAYLOAD_FIELDS } from '@agri-erp/shared';

/**
 * LIVE UPDATES CARRY IDS, AND THE CODE KNOWS NO ACCOUNT (2026-10-26).
 *
 * 1. Every `emitRealtime({...})` in the application names only fields from
 *    REALTIME_PAYLOAD_FIELDS in its `data` -- no body, title, text, name or
 *    phone can be put on an event (publish.ts also strips them at run time).
 * 2. The realtime, match-alert and presence code names no demo account, no
 *    product, no state: it works for every account, organisation, category,
 *    product and state, driven by data only.
 * 3. The webhook verifies the signature before it reads the event.
 */

const web = fileURLToPath(new URL('..', import.meta.url));
const shared = fileURLToPath(new URL('../../../packages/shared/src', import.meta.url));
const read = (path: string) => readFileSync(path, 'utf8');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === 'tests') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

describe('live events carry ids only', () => {
  const files = [...sources(join(web, 'lib')), ...sources(join(web, 'app'))];
  const calls = files.flatMap((file) => {
    const text = read(file);
    const found: { file: string; data: string }[] = [];
    let at = text.indexOf('emitRealtime({');
    while (at !== -1) {
      const start = text.indexOf('data:', at);
      const open = text.indexOf('{', start);
      let depth = 0;
      let end = open;
      for (; end < text.length; end++) {
        if (text[end] === '{') depth++;
        if (text[end] === '}' && --depth === 0) break;
      }
      found.push({ file, data: text.slice(open, end + 1) });
      at = text.indexOf('emitRealtime({', end);
    }
    return found;
  });

  it('finds the publishing call sites, so this cannot pass by checking nothing', () => {
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it.each(calls.map((c) => [c.file.slice(web.length), c.data]))(
    '%s names only allowed fields',
    (_file, data) => {
      const keys = [...(data as string).matchAll(/(\w+)\s*:/g)].map((m) => m[1]);
      const allowed = new Set<string>([...REALTIME_PAYLOAD_FIELDS, 'kind', 'id']);
      for (const key of keys) expect(allowed.has(key as string), `field "${key}"`).toBe(true);
    },
  );
});

describe('the realtime, match and presence code knows no particular account', () => {
  const files = [
    join(shared, 'realtime.ts'),
    join(shared, 'presence.ts'),
    join(shared, 'match-alerts.ts'),
    ...sources(join(web, 'lib/realtime')),
    join(web, 'lib/api/match-alerts.ts'),
    join(web, 'lib/api/presence.ts'),
    join(web, 'lib/api/sms-receipts.ts'),
    join(web, 'lib/sms/bird-webhook.ts'),
    ...sources(join(web, 'components/live')),
    join(web, 'app/api/realtime/auth/route.ts'),
    join(web, 'app/api/realtime/channels/route.ts'),
    join(web, 'app/api/webhooks/bird/route.ts'),
    join(web, 'app/api/account/notifications/[id]/route.ts'),
  ];

  it.each(files.map((f) => [f.replace(/\\/g, '/').split('/').slice(-3).join('/'), f]))(
    '%s has no demo account, product, state or fixed id',
    (_name, file) => {
      const text = read(file as string);
      expect(text).not.toMatch(/\bdemo\b/i);
      expect(text).not.toMatch(/example\.invalid/i);
      expect(text).not.toMatch(/maize|akello|equatoria|juba county/i);
      expect(text).not.toMatch(/\+211\s?9\d{2}\s?\d{3}\s?\d{3}/);
      // No account, organisation or post id written into code.
      expect(text).not.toMatch(
        /['"`][0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}['"`]/i,
      );
    },
  );
});

describe('the Bird webhook', () => {
  const route = read(join(web, 'app/api/webhooks/bird/route.ts'));

  it('fails closed without its secret and verifies before it parses', () => {
    expect(route).toMatch(/BIRD_WEBHOOK_SECRET/);
    expect(route).toMatch(/503/);
    expect(route.indexOf('verifyWebhook(')).toBeGreaterThan(0);
    expect(route.indexOf('verifyWebhook(')).toBeLessThan(route.indexOf('JSON.parse('));
  });

  it('stores no number and no text', () => {
    const migration = read(
      join(
        web,
        '../../prisma/migrations/20261101090000_realtime_receipts_match_alerts/migration.sql',
      ),
    );
    for (const table of ['bird_webhook_event', 'sms_opt_out', 'marketing_notice']) {
      const block = migration.slice(migration.indexOf(`CREATE TABLE "public"."${table}"`));
      const columns = block.slice(0, block.indexOf(');'));
      expect(columns, table).not.toMatch(/"(phone|destination|text|body|title)"/);
    }
  });
});
