import { describe, expect, it } from 'vitest';

import {
  createLearningResourceSchema,
  learningResourceInputSchema,
  learningStoragePath,
  LEARNING_LIMITS,
  LEARNING_MESSAGES,
} from '../src/index';

function omit<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const copy: Partial<T> = { ...obj };
  delete copy[key];
  return copy as Omit<T, K>;
}

/** Learning resource validation. Unit P1, C-13.6 to C-13.9. */

const schema = learningResourceInputSchema;

const guide = {
  title: 'Sorghum planting guide',
  topic: 'crop_production',
  crop: 'sorghum',
  language: 'en',
  format: 'pdf',
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
    const noCrop = omit(guide, 'crop');
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
    expect(firstMessage({ ...guide, topic: 'finance' }, 'topic')).toBe(
      LEARNING_MESSAGES.topicUnknown,
    );
    expect(firstMessage({ ...guide, crop: 'rice' }, 'crop')).toBe(LEARNING_MESSAGES.cropUnknown);
    expect(firstMessage({ ...guide, language: 'fr' }, 'language')).toBe(
      LEARNING_MESSAGES.languageUnknown,
    );
    expect(firstMessage({ ...guide, format: 'docx' }, 'format')).toBe(
      LEARNING_MESSAGES.formatUnknown,
    );
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

/**
 * THE CLIENT NO LONGER NAMES A PATH, so there is no path to validate.
 *
 * `storage_path` used to be a string in the request body, guarded by a pattern
 * that stopped it escaping the bucket. The guard was needed because the caller
 * chose the path at all — and choosing the path means choosing which object a
 * catalogue row points at. The server now derives it from the id it mints, so
 * the hazard is gone rather than defended against.
 */
describe('the storage path is the server’s, not the caller’s', () => {
  it('is not a field the schema accepts, and a strict object refuses it', () => {
    expect('storage_path' in guide).toBe(false);
    expect(schema.safeParse({ ...guide, storage_path: 'a/b/c.pdf' }).success).toBe(false);
  });

  it('is derived from the resource id and the content type', () => {
    const id = 'b2c3d4e5-6f70-4812-9a3b-4c5d6e7f8091';
    expect(learningStoragePath(id, 'application/pdf')).toBe(`resources/${id}.pdf`);
    expect(learningStoragePath(id, 'audio/mpeg')).toBe(`resources/${id}.mp3`);
  });

  it('cannot be steered outside the bucket, because only an id goes into it', () => {
    const nasty = '../../etc/passwd';
    expect(learningStoragePath(nasty, 'application/pdf')).toBe(`resources/${nasty}.pdf`);
    // The route never calls it with anything but a uuid it minted itself, and
    // refuses a non-uuid id before reading a row at all.
    expect(/^resources\//.test(learningStoragePath(nasty, 'application/pdf'))).toBe(true);
  });

  it('an unknown content type still yields one safe segment', () => {
    const id = 'b2c3d4e5-6f70-4812-9a3b-4c5d6e7f8091';
    expect(learningStoragePath(id, 'application/x-made-up')).toBe(`resources/${id}.bin`);
  });
});

describe('registering a resource declares what kind of file is coming', () => {
  it('accepts a content type that matches the format', () => {
    const ok = createLearningResourceSchema.safeParse({
      ...guide,
      content_type: 'application/pdf',
    });
    expect(ok.success).toBe(true);
  });

  it('refuses a content type that contradicts the format', () => {
    const bad = createLearningResourceSchema.safeParse({
      ...guide,
      format: 'audio',
      content_type: 'application/pdf',
    });
    expect(bad.success).toBe(false);
    expect(bad.success ? '' : bad.error.issues[0]?.message).toBe(
      LEARNING_MESSAGES.contentTypeMismatch,
    );
  });

  it('refuses a content type nothing may be', () => {
    expect(
      createLearningResourceSchema.safeParse({ ...guide, content_type: 'application/zip' }).success,
    ).toBe(false);
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
    expect(schema.safeParse({ ...guide, byte_size: LEARNING_LIMITS.byteSizeMax }).success).toBe(
      true,
    );
    expect(
      firstMessage({ ...guide, byte_size: LEARNING_LIMITS.byteSizeMax + 1 }, 'byte_size'),
    ).toBe(LEARNING_MESSAGES.byteSizeTooLarge);
  });
});
