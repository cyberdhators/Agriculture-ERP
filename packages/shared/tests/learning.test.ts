import { describe, expect, it } from 'vitest';

import { LEARNING_LIMITS, LEARNING_MESSAGES, learningResourceInputSchema } from '../src/index';

/** Learning resource validation. Unit P1, C-13.6 to C-13.9. */

const schema = learningResourceInputSchema;

const guide = {
  title: 'Sorghum planting guide',
  topic: 'crop_production',
  crop: 'sorghum',
  language: 'en',
  format: 'pdf',
  storage_path: 'learning/2026/sorghum-planting.pdf',
  byte_size: 812_000,
};

const firstMessage = (input: unknown, field: string): string | undefined => {
  const result = schema.safeParse(input);
  if (result.success) return undefined;
  return result.error.issues.find((i) => i.path.join('.') === field)?.message;
};

describe('a minimal resource', () => {
  it('accepts a guide and starts it unpublished', () => {
    const result = schema.parse(guide);
    expect(result.published).toBe(false);
  });

  it('accepts a resource with no crop, because not every topic has one', () => {
    const { crop: _crop, ...noCrop } = guide;
    expect(schema.safeParse({ ...noCrop, topic: 'cooperative' }).success).toBe(true);
    expect(schema.parse({ ...guide, crop: null }).crop).toBeNull();
  });

  it('refuses a key it does not know, so a quiz score cannot be smuggled in', () => {
    expect(schema.safeParse({ ...guide, score: 10 }).success).toBe(false);
  });
});

describe('enumerations', () => {
  it('accepts both languages including the hyphenated one', () => {
    expect(schema.safeParse({ ...guide, language: 'ar-juba' }).success).toBe(true);
  });

  it('refuses an unknown topic, crop, language and format, each with its own sentence', () => {
    expect(firstMessage({ ...guide, topic: 'finance' }, 'topic')).toBe(LEARNING_MESSAGES.topicUnknown);
    expect(firstMessage({ ...guide, crop: 'rice' }, 'crop')).toBe(LEARNING_MESSAGES.cropUnknown);
    expect(firstMessage({ ...guide, language: 'fr' }, 'language')).toBe(
      LEARNING_MESSAGES.languageUnknown,
    );
    expect(firstMessage({ ...guide, format: 'docx' }, 'format')).toBe(LEARNING_MESSAGES.formatUnknown);
  });
});

describe('title', () => {
  it('trims and preserves a title exactly', () => {
    expect(schema.parse({ ...guide, title: ' دليل زراعة الذرة ' }).title).toBe('دليل زراعة الذرة');
  });

  it('refuses a blank title and one over the limit, and accepts one at it', () => {
    expect(firstMessage({ ...guide, title: ' ' }, 'title')).toBe(LEARNING_MESSAGES.titleBlank);
    const atLimit = 't'.repeat(LEARNING_LIMITS.titleMax);
    expect(schema.safeParse({ ...guide, title: atLimit }).success).toBe(true);
    expect(firstMessage({ ...guide, title: `${atLimit}t` }, 'title')).toBe(
      LEARNING_MESSAGES.titleTooLong,
    );
  });
});

describe('storage path', () => {
  it('accepts a nested relative path', () => {
    expect(schema.safeParse({ ...guide, storage_path: 'a/b/c.pdf' }).success).toBe(true);
  });

  it('refuses a leading slash, a parent segment, a double slash and a space', () => {
    for (const bad of ['/learning/x.pdf', 'learning/../secret.pdf', 'a//b.pdf', 'a b.pdf', '..']) {
      expect(firstMessage({ ...guide, storage_path: bad }, 'storage_path'), bad).toBe(
        LEARNING_MESSAGES.storagePathShape,
      );
    }
  });

  it('refuses an empty path with its own sentence', () => {
    expect(firstMessage({ ...guide, storage_path: '' }, 'storage_path')).toBe(
      LEARNING_MESSAGES.storagePathRequired,
    );
  });
});

describe('byte size', () => {
  it('refuses zero, a fraction and a string', () => {
    expect(firstMessage({ ...guide, byte_size: 0 }, 'byte_size')).toBe(
      LEARNING_MESSAGES.byteSizeTooSmall,
    );
    expect(firstMessage({ ...guide, byte_size: 1.5 }, 'byte_size')).toBe(
      LEARNING_MESSAGES.byteSizeNotWhole,
    );
    expect(firstMessage({ ...guide, byte_size: '812000' }, 'byte_size')).toBe(
      LEARNING_MESSAGES.byteSizeNotWhole,
    );
  });

  it('accepts exactly the maximum and refuses one byte more', () => {
    expect(schema.safeParse({ ...guide, byte_size: LEARNING_LIMITS.byteSizeMax }).success).toBe(true);
    expect(firstMessage({ ...guide, byte_size: LEARNING_LIMITS.byteSizeMax + 1 }, 'byte_size')).toBe(
      LEARNING_MESSAGES.byteSizeTooLarge,
    );
  });
});
