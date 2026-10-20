import { describe, expect, it } from 'vitest';

import { LEARNING_RESOURCES } from '@/lib/fixtures/p1';

import { getGuide, guideText, listGuides, matchesGuide, type PublicGuide } from './guides';

/**
 * The public guides page's data layer (2026-10-22). With
 * NEXT_PUBLIC_USE_LIVE_LIBRARY unset -- as here -- it serves the fixtures'
 * PUBLISHED rows, so these tests also pin that a draft or a guide in review
 * never reaches the public page in the preview either.
 */

const guide: PublicGuide = {
  id: 'g-1',
  title: 'Sorghum planting guide',
  title_ar: 'دليل زراعة الذرة الرفيعة',
  summary: 'Row spacing and seed rate.',
  summary_ar: null,
  topics: ['crops', 'soil_fertiliser'],
  crop: 'sorghum',
  language: 'en',
  format: 'pdf',
  byte_size: 1000,
  published_on: '2026-08-12T10:04:00.000Z',
};

describe('guideText', () => {
  it('gives an Arabic reader the Arabic title, and the English summary when there is no Arabic one', () => {
    expect(guideText(guide, 'ar')).toEqual({
      title: 'دليل زراعة الذرة الرفيعة',
      summary: 'Row spacing and seed rate.',
      translated: true,
    });
  });

  it('says so when an Arabic reader is shown English', () => {
    expect(guideText({ ...guide, title_ar: null }, 'ar').translated).toBe(false);
    expect(guideText(guide, 'en')).toMatchObject({ title: guide.title, translated: true });
  });
});

describe('matchesGuide', () => {
  it('filters by topic, file language and words in either language', () => {
    expect(matchesGuide(guide, { topic: 'soil_fertiliser' })).toBe(true);
    expect(matchesGuide(guide, { topic: 'livestock' })).toBe(false);
    expect(matchesGuide(guide, { language: 'ar' })).toBe(false);
    expect(matchesGuide(guide, { q: 'SEED' })).toBe(true);
    expect(matchesGuide(guide, { q: 'الذرة' })).toBe(true);
    expect(matchesGuide(guide, { q: 'goat' })).toBe(false);
  });
});

describe('the preview serves published guides only', () => {
  it('lists every published fixture and nothing else', async () => {
    const listed = (await listGuides({})).map((g) => g.id).sort();
    const published = LEARNING_RESOURCES.filter((r) => r.status === 'published')
      .map((r) => r.id)
      .sort();
    expect(listed).toEqual(published);
    expect(listed.length).toBeGreaterThan(0);
  });

  it('answers null for a draft or a guide in review', async () => {
    const hidden = LEARNING_RESOURCES.filter((r) => r.status !== 'published');
    expect(hidden.length).toBeGreaterThan(0);
    for (const r of hidden) expect(await getGuide(r.id)).toBeNull();
  });
});
