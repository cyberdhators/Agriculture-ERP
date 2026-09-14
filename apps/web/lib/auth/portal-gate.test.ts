import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { LOGIN_PATH, PORTAL_PREFIXES } from './paths';

/**
 * THE PORTAL GATE IS THREE LISTS, AND THIS IS THE ONE THING THAT COMPARES THEM.
 *
 * Whether a staff screen requires a session is decided by three sources that
 * move independently:
 *
 *   1. the directories under `apps/web/app/(portal)/` -- the screens that exist;
 *   2. `PORTAL_PREFIXES` in ./paths.ts -- what `isPortalPath` guards;
 *   3. `config.matcher` in ../../middleware.ts -- what the middleware even runs on.
 *
 * A page added under a new prefix and listed in neither is **served to anyone
 * with no session**, and every test in `paths.test.ts` still passes: that file
 * asserts the prefixes it names are guarded, which cannot notice a prefix
 * nobody named. That is the single-fact gate of docs/PROJECT-STATE.md, in the
 * auth gate -- the worst place in the project for it.
 *
 * #73 adding `/reports` and updating both lists is a habit, not a guarantee.
 * This test is the guarantee. It compares, so it goes red by itself when any
 * one of the three moves alone.
 *
 * Data is still protected if this ever fails -- every route enforces
 * `requireRole` -- but an ungated screen renders internal chrome to the public
 * and is one server-side fetch away from being worse.
 */

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

/** Top-level URL segments of the (portal) route group, as the filesystem has them. */
function portalSegmentsOnDisk(): string[] {
  const dir = here('../../app/(portal)');
  return (
    readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      // Route groups like (auth) are not URL segments; dynamic segments cannot be
      // a top-level portal prefix and would be a design change, not a new screen.
      .filter((e) => !e.name.startsWith('(') && !e.name.startsWith('['))
      .map((e) => `/${e.name}`)
      .sort()
  );
}

/** The paths `config.matcher` in the middleware applies to. */
function matcherPaths(): string[] {
  const source = readFileSync(here('../../middleware.ts'), 'utf8');
  const block = source.slice(source.indexOf('matcher:'));
  return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

describe('the portal gate compares its three sources', () => {
  it('every screen under (portal) has a prefix that isPortalPath guards', () => {
    const onDisk = portalSegmentsOnDisk();
    expect(
      onDisk.length,
      'no portal screens found -- this test is looking in the wrong place',
    ).toBeGreaterThan(0);
    const guarded = [...PORTAL_PREFIXES];
    const ungated = onDisk.filter(
      (seg) => !guarded.includes(seg as (typeof PORTAL_PREFIXES)[number]),
    );
    expect(
      ungated,
      'These portal screens exist on disk and are NOT in PORTAL_PREFIXES, so isPortalPath ' +
        'returns false for them and the middleware will not redirect an anonymous visitor. ' +
        'Add them to PORTAL_PREFIXES in lib/auth/paths.ts AND to config.matcher in middleware.ts.',
    ).toEqual([]);
  });

  it('every guarded prefix is a screen that exists', () => {
    const onDisk = portalSegmentsOnDisk();
    const orphaned = [...PORTAL_PREFIXES].filter((p) => !onDisk.includes(p));
    expect(
      orphaned,
      'These prefixes are guarded but no longer exist under app/(portal). A stale prefix is ' +
        'harmless but it means this list is no longer describing the application, which is how ' +
        'the next real gap hides.',
    ).toEqual([]);
  });

  it('PORTAL_PREFIXES and the middleware matcher agree', () => {
    const matcher = matcherPaths();
    expect(matcher.length, 'no matcher entries parsed from middleware.ts').toBeGreaterThan(0);

    // The matcher covers each prefix and its children, plus the login page.
    const expected = [...PORTAL_PREFIXES]
      .map((p) => `${p}/:path*`)
      .concat(LOGIN_PATH)
      .sort();
    expect(
      [...matcher].sort(),
      'The middleware matcher and PORTAL_PREFIXES disagree. A prefix in PORTAL_PREFIXES but ' +
        'not the matcher is NOT gated -- the middleware never runs on it, whatever isPortalPath ' +
        'says. A prefix in the matcher but not PORTAL_PREFIXES costs a wasted invocation.',
    ).toEqual(expected);
  });
});
