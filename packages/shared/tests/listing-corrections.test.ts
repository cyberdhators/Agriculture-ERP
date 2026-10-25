import { describe, expect, it } from 'vitest';

import {
  CORRECTION_LIMITS,
  CORRECTION_TARGETS,
  LISTING_CORRECTION_MESSAGES,
  correctionListQuerySchema,
  correctionRequestSchema,
  correctionStatusAfterEdit,
  editAddressesCorrection,
} from '../src/index';

/**
 * A MODERATOR ASKS FOR A CORRECTION (2026-10-27): what a request carries, and
 * which of the owner's saves count as addressing it.
 */

const ID = '11111111-2222-4333-8444-555555555555';
const request = (over: Record<string, unknown> = {}) => ({
  target_type: 'produce_listing',
  target_id: ID,
  reason_code: 'misleading_listing',
  note: 'The photo shows maize, the title says sorghum.',
  ...over,
});

describe('a correction request', () => {
  it('names one of the three kinds of post, a reason code and a note', () => {
    for (const target_type of CORRECTION_TARGETS) {
      expect(correctionRequestSchema.safeParse(request({ target_type })).success).toBe(true);
    }
    const profile = correctionRequestSchema.safeParse(request({ target_type: 'profile' }));
    expect(profile.error?.issues[0]?.message).toBe(LISTING_CORRECTION_MESSAGES.targetUnknown);
  });

  it('requires the reason code and the note, within their limits', () => {
    const noCode = correctionRequestSchema.safeParse(request({ reason_code: undefined }));
    expect(noCode.error?.issues[0]?.message).toBe(LISTING_CORRECTION_MESSAGES.reasonCodeRequired);
    expect(correctionRequestSchema.safeParse(request({ reason_code: 'Not A Code' })).success).toBe(
      false,
    );
    const short = correctionRequestSchema.safeParse(request({ note: ' fix ' }));
    expect(short.error?.issues[0]?.message).toBe(LISTING_CORRECTION_MESSAGES.noteInvalid);
    expect(
      correctionRequestSchema.safeParse(
        request({ note: 'x'.repeat(CORRECTION_LIMITS.noteMax + 1) }),
      ).success,
    ).toBe(false);
    const trimmed = correctionRequestSchema.safeParse(request({ note: '  Change the price.  ' }));
    expect(trimmed.success && trimmed.data.note).toBe('Change the price.');
  });

  it('refuses a malformed post id and any field it does not know', () => {
    expect(correctionRequestSchema.safeParse(request({ target_id: '12' })).success).toBe(false);
    expect(correctionRequestSchema.safeParse(request({ remove: true })).success).toBe(false);
  });

  it('the list filters by status, post type and post', () => {
    expect(correctionListQuerySchema.safeParse({ status: 'open' }).success).toBe(true);
    expect(
      correctionListQuerySchema.safeParse({ status: 'addressed', target_id: ID }).success,
    ).toBe(true);
    expect(correctionListQuerySchema.safeParse({ status: 'closed' }).success).toBe(false);
  });
});

describe('an owner save addresses a correction only when it changes the content', () => {
  it('a lifecycle move or a renewal alone does not', () => {
    expect(editAddressesCorrection(['status'])).toBe(false);
    expect(editAddressesCorrection(['available_until'])).toBe(false);
    expect(editAddressesCorrection(['status', 'needed_by'])).toBe(false);
    expect(editAddressesCorrection([])).toBe(false);
  });

  it('any content field does', () => {
    expect(editAddressesCorrection(['title'])).toBe(true);
    expect(editAddressesCorrection(['status', 'price_ssp'])).toBe(true);
    expect(editAddressesCorrection(['description'])).toBe(true);
  });

  it('open becomes addressed on such a save; addressed stays addressed', () => {
    expect(correctionStatusAfterEdit('open', ['title'])).toBe('addressed');
    expect(correctionStatusAfterEdit('open', ['status'])).toBe('open');
    expect(correctionStatusAfterEdit('addressed', [])).toBe('addressed');
  });
});
