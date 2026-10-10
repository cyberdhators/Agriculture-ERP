import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buyerPhoneSchema } from '../src/buyer';
import { parseSouthSudanMobile } from '../src/phone';

/**
 * ONE PHONE NORMALISER, AND A GATE THAT COMPARES FOR A SECOND.
 *
 * The arithmetic was never wrong; the duplication was the risk. `phone.ts`
 * turns a written South Sudan number into E.164 (strip the trunk 0, prepend
 * +211, nine national digits). When that logic is copied — buyer registration
 * once carried its own `+211${…}` build and its own `/^0\d{9}$/` — the copies
 * drift and only one of them is ever reviewed.
 *
 * So this gate reads the source from OUTSIDE and fails if the normalisation
 * arithmetic appears anywhere but `phone.ts`. It does not forbid MENTIONING the
 * country code (messages say "starting +211", comments show "+211XXXXXXXXX");
 * it forbids BUILDING a number with it — a `+211` immediately interpolated or
 * concatenated — and the trunk-0 detection regex. `phone.ts` builds from a
 * `COUNTRY_CODE` constant and `startsWith('0')`, so it does not match either
 * signature and is not exempted by name for its own sake.
 *
 * The signatures are assembled from fragments so this file does not match
 * itself, the same device the suite-completeness guards use.
 */
const root = fileURLToPath(new URL('../../..', import.meta.url));

// Built from fragments so this test's own source does not trip the gate.
const BUILD_WITH_CODE = '+' + '211' + '${'; // a literal +211 interpolated into a template
const BUILD_CONCAT = "'+" + "211'"; // a literal '+211' string, the start of a concat build
const TRUNK_ZERO = '/^' + '0\\d{9}$/'; // the trunk-0 detection regex
const SIGNATURES = [BUILD_WITH_CODE, BUILD_CONCAT, TRUNK_ZERO];

/** The one file allowed to hold the South Sudan phone arithmetic. */
const HOME = join('packages', 'shared', 'src', 'phone.ts').replace(/\\/g, '/');

/**
 * Synthetic-data generators are exempt. A fixture or seed BUILDS invented
 * numbers (`+2119220000${i}`); it does not NORMALISE a number a person typed,
 * which is the only thing that must agree with phone.ts. Excluded by path, not
 * by guesswork: anything under a `fixtures` directory or a `*-seed` module.
 */
const isGenerator = (rel: string): boolean => /\/fixtures\/|(^|\/)[^/]*seed[^/]*\.tsx?$/.test(rel);

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    if (['node_modules', '.next', 'dist', 'build', '.git'].includes(entry) || entry.startsWith('.'))
      continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if ((entry.endsWith('.ts') || entry.endsWith('.tsx')) && !entry.endsWith('.test.ts'))
      out.push(full);
  }
  return out;
};

describe('the South Sudan phone normaliser lives in exactly one place', () => {
  const scanned = [join(root, 'packages', 'shared', 'src'), join(root, 'apps', 'web')].flatMap(
    (d) => walk(d),
  );

  it('found source to scan at all', () => {
    // A walk that silently finds nothing would make the gate vacuously green —
    // the empty-set trap. Assert it reached real files first.
    expect(scanned.length).toBeGreaterThan(20);
  });

  it('no file but phone.ts builds a South Sudan number', () => {
    const offenders: string[] = [];
    for (const file of scanned) {
      const rel = file
        .slice(root.length)
        .replace(/^[/\\]/, '')
        .replace(/\\/g, '/');
      if (rel === HOME || isGenerator(rel)) continue;
      const source = readFileSync(file, 'utf8');
      const hits = SIGNATURES.filter((sig) => source.includes(sig));
      if (hits.length > 0) offenders.push(`${rel} (${hits.join(', ')})`);
    }
    expect(
      offenders,
      'these files reimplement the South Sudan phone arithmetic instead of calling ' +
        'parseSouthSudanMobile in packages/shared/src/phone.ts. Route them through it: ' +
        offenders.join('; '),
    ).toEqual([]);
  });
});

describe('buyerPhoneSchema, now routed through the one normaliser, is unchanged for SS numbers', () => {
  const canonical = '+211912345678';
  for (const written of ['0912345678', '+211912345678', '211912345678', '+211 912 345 678']) {
    it(`normalises ${written} to canonical E.164`, () => {
      expect(buyerPhoneSchema.parse(written)).toBe(canonical);
      // And it agrees with the one normaliser it now delegates to.
      const ss = parseSouthSudanMobile(written);
      expect(ss.ok && ss.value).toBe(canonical);
    });
  }

  it('still accepts a non-South-Sudan international number (buyers may be abroad)', () => {
    expect(buyerPhoneSchema.parse('+254712345678')).toBe('+254712345678');
  });

  it('still rejects something that is no phone number at all', () => {
    expect(() => buyerPhoneSchema.parse('not-a-number')).toThrow();
  });
});
