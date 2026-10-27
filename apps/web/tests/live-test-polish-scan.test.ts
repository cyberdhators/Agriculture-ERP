import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { unitLabelOf } from '../lib/buyer/labels';
import { tCount } from '../lib/i18n';

/**
 * LIVE-TEST POLISH (2026-10-27). Three things live testing found:
 *   1. the Analyst (read_only with reports.view) had no "Download Excel" on
 *      the analytics pages, though both export routes accept that role;
 *   2. ratings read "1 ratings";
 *   3. public profiles printed the stored unit ("bag_50kg") instead of its label.
 */

const web = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string) => readFileSync(join(web, path), 'utf8');

describe('the rating count has its plural form', () => {
  it('English: one rating, many ratings', () => {
    expect(tCount('rate.count', 0, 'en')).toBe('0 ratings');
    expect(tCount('rate.count', 1, 'en')).toBe('1 rating');
    expect(tCount('rate.count', 2, 'en')).toBe('2 ratings');
    expect(tCount('rate.count', 25, 'en')).toBe('25 ratings');
  });

  it('Arabic: the form Intl.PluralRules picks for each count', () => {
    expect(tCount('rate.count', 1, 'ar')).toBe('1 تقييم');
    expect(tCount('rate.count', 2, 'ar')).toBe('2 تقييمان');
    expect(tCount('rate.count', 3, 'ar')).toBe('3 تقييمات');
    expect(tCount('rate.count', 10, 'ar')).toBe('10 تقييمات');
    expect(tCount('rate.count', 11, 'ar')).toBe('11 تقييمًا');
    expect(tCount('rate.count', 100, 'ar')).toBe('100 تقييم');
  });

  it('the ratings block uses it, not a fixed plural', () => {
    const src = read('components/ratings/Ratings.tsx');
    expect(src).not.toMatch(/\bt\('rate\.count/);
    expect(src.match(/tCount\('rate\.count'/g)?.length).toBe(2);
  });
});

describe('units are shown by their label', () => {
  it('a known unit reads as its label in either language; an unknown one as it is', () => {
    expect(unitLabelOf('bag_50kg', 'en')).toBe('50 kg bag');
    expect(unitLabelOf('bag_50kg', 'ar')).toMatch(/[؀-ۿ]/);
    expect(unitLabelOf('kg')).toBe('kg');
    expect(unitLabelOf('something_new')).toBe('something_new');
  });

  it('no public profile or rating screen prints a raw unit', () => {
    for (const path of [
      'components/public-profile/PublicProfilePage.tsx',
      'components/profiles/PublicProfile.tsx',
      'components/teams/PublicOrganisation.tsx',
      'components/ratings/Ratings.tsx',
    ]) {
      const src = read(path);
      expect(src, path).not.toMatch(/\$\{\w+\.(unit|price_per|preferred_unit)\}/);
      expect(src, path).not.toMatch(/\{\w+\.(unit|price_per|preferred_unit)\}/);
    }
  });
});

describe('the Analyst can download the Excel the route allows', () => {
  for (const [page, route] of [
    ['components/analytics/Analytics.tsx', 'app/api/analytics/export/route.ts'],
    [
      'components/analytics/MatchAlertResults.tsx',
      'app/api/analytics/match-alerts/export/route.ts',
    ],
  ] as const) {
    it(page, () => {
      expect(read(route)).toContain("roles: ['admin', 'supervisor', 'read_only']");
      expect(read(route)).toContain("'reports.view'");
      expect(read(page)).toMatch(
        /canExport =\s+hydrated && \(role === 'admin' \|\| role === 'supervisor' \|\| role === 'read_only'\)/,
      );
    });
  }
});
