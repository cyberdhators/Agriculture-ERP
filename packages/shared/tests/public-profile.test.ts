import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ACTIVITIES,
  MARKET_POST_MESSAGES,
  MARKET_REPORT_TARGETS,
  PROFILE_PHOTO_CONTENT_TYPES,
  PROFILE_PHOTO_LIMITS,
  PUBLIC_PROFILE_LIMITS,
  PUBLIC_PROFILE_MESSAGES,
  PUBLIC_PROFILE_STATUSES,
  profilePhotoConfirmSchema,
  profilePhotoPath,
  profilePhotoUploadSchema,
  publicProfileSaveSchema,
} from '../src';

/**
 * PUBLIC PROFILES V2 (2026-10-23): the shapes the profile routes accept, and
 * the lists the database checks, held to each other.
 */

const migration = readFileSync(
  fileURLToPath(
    new URL(
      '../../../prisma/migrations/20261023090000_public_profile_v2/migration.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);

const UPLOAD = '7a1b2c3d-0000-4000-8000-000000000001';
const PUBLIC_ID = '7a1b2c3d-0000-4000-8000-000000000002';

const valid = {
  display_name: 'Amina',
  activities: ['farmer', 'processor'],
  state_id: 'CE',
  payam_id: 'CE-JUB-MUN',
  about: 'I grow maize and process groundnuts.',
  products: ['Maize'],
  services: ['Groundnut processing'],
  show_phone: false,
  allow_messages: true,
};

const reasons = (input: unknown) => {
  const parsed = publicProfileSaveSchema.safeParse(input);
  return parsed.success
    ? {}
    : Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
};

describe('saving a public profile', () => {
  it('accepts the infographic example and keeps it as given', () => {
    const parsed = publicProfileSaveSchema.parse(valid);
    expect(parsed).toEqual(valid);
  });

  it('never carries a status: saving never publishes', () => {
    expect(publicProfileSaveSchema.safeParse({ ...valid, status: 'published' }).success).toBe(
      false,
    );
  });

  it('needs a name of 2 to 120 characters', () => {
    expect(reasons({ ...valid, display_name: ' A ' }).display_name).toBe(
      PUBLIC_PROFILE_MESSAGES.displayNameInvalid,
    );
    expect(reasons({ ...valid, display_name: 'x'.repeat(121) }).display_name).toBe(
      PUBLIC_PROFILE_MESSAGES.displayNameInvalid,
    );
  });

  it('takes activities from the account list only, each once', () => {
    expect(reasons({ ...valid, activities: ['astronaut'] }).activities).toBe(
      PUBLIC_PROFILE_MESSAGES.activityUnknown,
    );
    expect(
      publicProfileSaveSchema.parse({ ...valid, activities: ['farmer', 'farmer'] }).activities,
    ).toEqual(['farmer']);
    expect(
      publicProfileSaveSchema.parse({ ...valid, activities: [...ACTIVITIES] }).activities,
    ).toHaveLength(ACTIVITIES.length);
  });

  it('keeps location general and optional, and a payam needs its state', () => {
    const none = publicProfileSaveSchema.parse({ ...valid, state_id: '', payam_id: null });
    expect(none.state_id).toBeNull();
    expect(none.payam_id).toBeNull();
    expect(reasons({ ...valid, state_id: null }).payam_id).toBe(
      PUBLIC_PROFILE_MESSAGES.payamNeedsState,
    );
    expect(reasons({ ...valid, state_id: 'not a code' }).state_id).toBe(
      PUBLIC_PROFILE_MESSAGES.stateInvalid,
    );
  });

  it('bounds the about text to 1000 characters and stores blank as none', () => {
    expect(reasons({ ...valid, about: 'x'.repeat(1001) }).about).toBe(
      PUBLIC_PROFILE_MESSAGES.aboutTooLong,
    );
    expect(publicProfileSaveSchema.parse({ ...valid, about: '   ' }).about).toBeNull();
  });

  it('allows at most ten short tags each, deduplicated without regard to case', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `crop ${i}`);
    expect(reasons({ ...valid, products: eleven }).products).toBe(
      PUBLIC_PROFILE_MESSAGES.productsTooMany,
    );
    expect(reasons({ ...valid, services: eleven }).services).toBe(
      PUBLIC_PROFILE_MESSAGES.servicesTooMany,
    );
    expect(reasons({ ...valid, products: ['x'.repeat(41)] }).products).toBe(
      PUBLIC_PROFILE_MESSAGES.tagInvalid,
    );
    expect(reasons({ ...valid, products: ['  '] }).products).toBe(
      PUBLIC_PROFILE_MESSAGES.tagInvalid,
    );
    expect(
      publicProfileSaveSchema.parse({ ...valid, products: ['Maize', 'maize'] }).products,
    ).toEqual(['Maize']);
  });

  it('needs a yes or no for both privacy choices', () => {
    expect(reasons({ ...valid, show_phone: 'yes' }).show_phone).toBe(
      MARKET_POST_MESSAGES.choiceUnknown,
    );
    const { allow_messages: _omitted, ...rest } = valid;
    expect(reasons(rest).allow_messages).toBe(MARKET_POST_MESSAGES.choiceUnknown);
  });

  it('refuses a field it does not know', () => {
    expect(publicProfileSaveSchema.safeParse({ ...valid, auth_user_id: PUBLIC_ID }).success).toBe(
      false,
    );
  });
});

describe('the profile photo', () => {
  it('accepts JPEG, PNG and WebP up to 2 MB, and nothing else', () => {
    for (const content_type of PROFILE_PHOTO_CONTENT_TYPES) {
      expect(profilePhotoUploadSchema.safeParse({ content_type, byte_size: 1000 }).success).toBe(
        true,
      );
    }
    const gif = profilePhotoUploadSchema.safeParse({ content_type: 'image/gif', byte_size: 1 });
    expect(gif.success).toBe(false);
    const big = profilePhotoUploadSchema.safeParse({
      content_type: 'image/jpeg',
      byte_size: PROFILE_PHOTO_LIMITS.maxBytes + 1,
    });
    expect(big.success ? null : big.error.issues[0]?.message).toBe(
      PUBLIC_PROFILE_MESSAGES.photoTooLarge,
    );
    expect(PROFILE_PHOTO_LIMITS.maxBytes).toBe(2 * 1024 * 1024);
  });

  it('confirms by upload id only, never a path', () => {
    expect(
      profilePhotoConfirmSchema.safeParse({ upload_id: UPLOAD, content_type: 'image/jpeg' })
        .success,
    ).toBe(true);
    expect(
      profilePhotoConfirmSchema.safeParse({
        upload_id: UPLOAD,
        content_type: 'image/jpeg',
        path: 'x/y.jpg',
      }).success,
    ).toBe(false);
    expect(
      profilePhotoConfirmSchema.safeParse({ upload_id: '../x', content_type: 'image/jpeg' })
        .success,
    ).toBe(false);
  });

  it('stores a photo under the public id and one upload id', () => {
    expect(profilePhotoPath(PUBLIC_ID, UPLOAD, 'image/webp')).toBe(`${PUBLIC_ID}/${UPLOAD}.webp`);
  });
});

describe('the migration holds the same lists', () => {
  it('the status CHECK is the shared list, and every existing row starts as a draft', () => {
    for (const status of PUBLIC_PROFILE_STATUSES) expect(migration).toContain(`'${status}'`);
    expect(migration).toMatch(/"status"\s+TEXT\s+NOT NULL DEFAULT 'draft'/);
  });

  it('the public address is its own uuid, never the sign-in id', () => {
    expect(migration).toMatch(/"public_id"\s+UUID\s+NOT NULL DEFAULT gen_random_uuid\(\)/);
    expect(migration).toMatch(/UNIQUE \("public_id"\)/);
  });

  it('phone off and messaging on by default', () => {
    expect(migration).toMatch(/"show_phone"\s+BOOLEAN\s+NOT NULL DEFAULT false/);
    expect(migration).toMatch(/"allow_messages"\s+BOOLEAN\s+NOT NULL DEFAULT true/);
  });

  it('bounds names, the about text and the tag lists as the schema does', () => {
    expect(migration).toContain(
      `BETWEEN ${PUBLIC_PROFILE_LIMITS.displayNameMin} AND ${PUBLIC_PROFILE_LIMITS.displayNameMax}`,
    );
    expect(migration).toContain(`<= ${PUBLIC_PROFILE_LIMITS.aboutMax}`);
    expect(migration).toContain(`cardinality("products") <= ${PUBLIC_PROFILE_LIMITS.tagsMax}`);
    expect(migration).toContain(`cardinality("services") <= ${PUBLIC_PROFILE_LIMITS.tagsMax}`);
  });

  it('a market report may be about a profile, as the shared list says', () => {
    expect(MARKET_REPORT_TARGETS).toContain('profile');
    expect(migration).toMatch(/"target_type" = 'profile' AND "profile_id" IS NOT NULL/);
  });

  it('does not touch the audit CHECK (one combined migration adds the keys)', () => {
    expect(migration).not.toMatch(/audit_event_action_known"?\s*CHECK/);
  });
});
