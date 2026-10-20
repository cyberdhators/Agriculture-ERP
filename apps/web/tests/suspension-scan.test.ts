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
    it(`/api/admin/accounts/${route} is admin-only and asks for content.moderate`, () => {
      const text = read(`app/api/admin/accounts/${route}/route.ts`);
      expect(text).toMatch(/roles: \['admin'\]/);
      expect(text).toMatch(/requirePermission\(auth, 'content\.moderate'\)/);
    });
  }
});
