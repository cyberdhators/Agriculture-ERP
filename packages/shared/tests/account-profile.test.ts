import { describe, expect, it } from 'vitest';

import { ACCOUNT_PROFILE_MESSAGES, accountProfileSchema } from '../src/index';

describe('who you are, what you do (2026-10-19)', () => {
  it('takes several activities, or none', () => {
    expect(
      accountProfileSchema.safeParse({
        profile_kind: 'individual',
        activities: ['farmer', 'trader', 'processor'],
      }).success,
    ).toBe(true);
    expect(
      accountProfileSchema.safeParse({ profile_kind: 'business', activities: [] }).success,
    ).toBe(true);
  });

  it('a group says what kind; nothing else may', () => {
    const noKind = accountProfileSchema.safeParse({ profile_kind: 'group', activities: [] });
    expect(noKind.error?.issues[0]?.message).toBe(ACCOUNT_PROFILE_MESSAGES.groupKindRequired);
    expect(
      accountProfileSchema.safeParse({
        profile_kind: 'group',
        group_kind: 'cooperative',
        activities: ['farmer'],
      }).success,
    ).toBe(true);
    const stray = accountProfileSchema.safeParse({
      profile_kind: 'individual',
      group_kind: 'sacco',
      activities: [],
    });
    expect(stray.error?.issues[0]?.message).toBe(ACCOUNT_PROFILE_MESSAGES.groupKindOnlyForGroups);
  });

  it('refuses unknown kinds and activities, and repeats', () => {
    expect(accountProfileSchema.safeParse({ profile_kind: 'club', activities: [] }).success).toBe(
      false,
    );
    expect(
      accountProfileSchema.safeParse({ profile_kind: 'individual', activities: ['miner'] }).success,
    ).toBe(false);
    expect(
      accountProfileSchema.safeParse({
        profile_kind: 'individual',
        activities: ['farmer', 'farmer'],
      }).success,
    ).toBe(false);
  });
});
