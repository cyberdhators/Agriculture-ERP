import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * A SUSPENDED ACCOUNT IS OFF THE MARKET AND OUT OF THE APP (2026-10-21).
 *
 * Suspension is enforced by filters in SQL text, not by one function, so this
 * reads the SQL and asserts each filter is there. A new market query that
 * joins a farmer or a buyer without the filter would show a suspended
 * account's posts; a session lookup without it would let them back in. Both
 * fail here, on the branch that writes them.
 */

const web = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(join(web, path), 'utf8');

/**
 * Every market poster join in a text -- the farmer `f` or buyer `b` a post is
 * joined to -- with what follows it on the line. Other aliases are history,
 * not the market: `fmr` names the farmer on a buyer's own past purchase
 * requests, which a suspension does not rewrite.
 */
const joinsOf = (text: string) =>
  text.match(/JOIN public\.(farmer|farmer_active|buyer_active) [fb] ON [^\n`]*/g) ?? [];

describe('the market leaves out suspended accounts', () => {
  for (const file of [
    'lib/api/buyer-presenters.ts',
    'lib/api/market-posts.ts',
    'app/api/listings/route.ts',
    'app/api/listings/[id]/route.ts',
  ]) {
    it(`every poster join in ${file} filters suspended_at`, () => {
      const text = read(file);
      const joins = joinsOf(text);
      expect(joins.length, `${file} has no poster join to check`).toBeGreaterThan(0);
      for (const join of joins) {
        // The filter may continue on the next line (listings routes).
        const at = text.indexOf(join);
        const window = text.slice(at, at + join.length + 80);
        expect(window, `${join} lets a suspended account through`).toMatch(/suspended_at IS NULL/);
      }
    });
  }
});

/**
 * SERVICES FOR ANY ACCOUNT (2026-10-26). A service is a farmer's or a buyer
 * account's, so its poster joins are LEFT joins, and a LEFT join filters
 * nothing by itself: what takes a removed or suspended poster's services off
 * is the poster-live condition. So every read of a service must carry it.
 */
describe('a service leaves with its suspended or removed poster, farmer or buyer', () => {
  const posts = read('lib/api/market-posts.ts');

  it('joins both kinds of poster through the live views, each filtering suspended_at', () => {
    const from = posts.match(/export const SERVICE_FROM = `([^`]*)`/)?.[1] ?? '';
    expect(from).toMatch(
      /LEFT JOIN public\.farmer_active f ON f\.id = sl\.farmer_id AND f\.suspended_at IS NULL/,
    );
    expect(from).toMatch(
      /LEFT JOIN public\.buyer_active b ON b\.id = sl\.buyer_id AND b\.suspended_at IS NULL/,
    );
  });

  it('the market and every own-record read require a live poster', () => {
    // 2026-10-27 (team access): or an OPEN organisation the service was made
    // for -- organisational continuity. The organisation join itself filters
    // closed and removed organisations, which this asserts too.
    expect(posts).toMatch(
      /export const SERVICE_POSTER_LIVE = `\(f\.id IS NOT NULL OR b\.id IS NOT NULL OR og\.id IS NOT NULL\)`/,
    );
    expect(posts).toMatch(
      /LEFT JOIN public\.organization og ON og\.id = sl\.organization_id\s+AND og\.deleted_at IS NULL AND og\.closed_at IS NULL/,
    );
    expect(posts).toMatch(/export const SERVICE_WHERE = SERVICE_POSTER_LIVE;/);
    expect(posts).toMatch(/export const SERVICE_MARKET_WHERE = `[^`]*\$\{SERVICE_POSTER_LIVE\}`/);
  });

  const readers = [
    'lib/api/market-posts.ts',
    'lib/api/messaging.ts',
    'lib/api/public-profile.ts',
    'app/api/services/route.ts',
    'app/api/services/mine/route.ts',
    'app/api/services/[id]/route.ts',
    'app/api/services/[id]/contact/route.ts',
    'app/api/profiles/[kind]/[id]/route.ts',
  ];
  for (const file of readers) {
    it(`every read of a service in ${file} carries the live-poster condition`, () => {
      const text = read(file);
      const at = [...text.matchAll(/\$\{SERVICE_FROM\}/g)].map((m) => m.index ?? 0);
      expect(at.length, `${file} reads no service`).toBeGreaterThan(0);
      for (const i of at) {
        const window = text.slice(i, i + 200);
        const direct = /\$\{SERVICE_(MARKET_)?WHERE\}/.test(window);
        // The public list builds its WHERE as a list that starts with the market filter.
        const built =
          /where\.join\(/.test(window) && /const where = \[SERVICE_MARKET_WHERE\]/.test(text);
        expect(direct || built, `${file}: a service read without the live-poster condition`).toBe(
          true,
        );
      }
    });
  }

  it('the public service shape names no farmer, buyer or sign-in id and no phone', () => {
    const body =
      posts.match(
        /export const presentService = \(row: ServiceRow\) => \(\{([\s\S]*?)\n\}\);/,
      )?.[1] ?? '';
    expect(body.length).toBeGreaterThan(100);
    for (const key of ['farmer_id', 'buyer_id', 'auth_user_id', 'contact_phone', 'payam_id']) {
      expect(body, `presentService returns ${key}`).not.toMatch(new RegExp(`\\b${key}\\s*:`));
    }
    expect(body, 'presentService spreads a row').not.toMatch(/\.\.\./);
  });

  it('deleting an account withdraws its services as a farmer and as a buyer', () => {
    const text = read('app/api/account/delete/route.ts');
    expect(text).toMatch(
      /UPDATE public\.service_listing SET status = 'withdrawn'[^`]*\(farmer_id = \$1::uuid OR buyer_id = \$2::uuid\)/,
    );
  });
});

describe('the advice directory leaves out suspended accounts (2026-10-22)', () => {
  it('a provider is live only through a farmer or buyer record that is not suspended', () => {
    const text = read('lib/api/advice.ts');
    expect(text).toMatch(/FROM public\.farmer_active fa\s+WHERE[^)]*fa\.suspended_at IS NULL/);
    expect(text).toMatch(/FROM public\.buyer_active ba\s+WHERE[^)]*ba\.suspended_at IS NULL/);
    expect(text).toMatch(/PROVIDER_PUBLIC_WHERE = [^;]*\$\{PROVIDER_ACCOUNT_LIVE\}/);
  });
});

describe('a suspended account cannot use the app', () => {
  it('the session lookup refuses a suspended farmer and a suspended buyer', () => {
    const text = read('lib/api/require-role.ts');
    expect(text).toMatch(/FROM public\.buyer_active b[\s\S]{0,200}b\.suspended_at IS NULL/);
    expect(text).toMatch(/FROM public\.farmer_active[\s\S]{0,200}suspended_at IS NULL/);
  });
});

describe('only moderators suspend and restore', () => {
  for (const route of ['suspend', 'restore', 'standing']) {
    it(`/api/admin/accounts/${route} admits the staff roles and asks for content.moderate`, () => {
      const text = read(`app/api/admin/accounts/${route}/route.ts`);
      expect(text).toMatch(/roles: \['admin', 'supervisor'(, 'read_only')?\]/);
      expect(text).toMatch(/requirePermission\(auth, 'content\.moderate'\)/);
    });
  }
});
