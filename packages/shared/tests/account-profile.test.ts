import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_PROFILE_MESSAGES,
  ENTERPRISE_SIZES,
  ENTERPRISE_SIZE_KINDS,
  accountProfileSchema,
  publicEnterpriseSize,
  takesEnterpriseSize,
} from '../src/index';

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

describe('enterprise size (2026-10-27): a size, not a kind of business', () => {
  it('a group, business or institution may state one, beside any activities', () => {
    for (const profile_kind of ENTERPRISE_SIZE_KINDS) {
      const body = {
        profile_kind,
        ...(profile_kind === 'group' ? { group_kind: 'cooperative' } : {}),
        activities: ['processor', 'trader'],
        enterprise_size: 'small',
        show_enterprise_size: true,
      };
      expect(accountProfileSchema.safeParse(body).success, profile_kind).toBe(true);
    }
  });

  it('"not stated" is null, and leaving it out is allowed', () => {
    expect(
      accountProfileSchema.safeParse({
        profile_kind: 'business',
        activities: [],
        enterprise_size: null,
      }).success,
    ).toBe(true);
    expect(
      accountProfileSchema.safeParse({ profile_kind: 'business', activities: [] }).success,
    ).toBe(true);
  });

  it('an individual states no size, and only the four labels are sizes', () => {
    const individual = accountProfileSchema.safeParse({
      profile_kind: 'individual',
      activities: [],
      enterprise_size: 'micro',
    });
    expect(individual.error?.issues[0]?.message).toBe(
      ACCOUNT_PROFILE_MESSAGES.sizeNotForIndividuals,
    );
    const sme = accountProfileSchema.safeParse({
      profile_kind: 'business',
      activities: [],
      enterprise_size: 'sme',
    });
    expect(sme.error?.issues[0]?.message).toBe(ACCOUNT_PROFILE_MESSAGES.sizeUnknown);
    expect([...ENTERPRISE_SIZES]).toEqual(['micro', 'small', 'medium', 'large']);
  });

  it('the public profile shows it only when the owner chose to, for a kind that takes one', () => {
    expect(publicEnterpriseSize('business', 'medium', true)).toBe('medium');
    expect(publicEnterpriseSize('business', 'medium', false)).toBeNull();
    expect(publicEnterpriseSize('business', null, true)).toBeNull();
    expect(publicEnterpriseSize('individual', 'medium', true)).toBeNull();
    expect(publicEnterpriseSize('group', 'huge', true)).toBeNull();
    expect(takesEnterpriseSize('institution')).toBe(true);
    expect(takesEnterpriseSize('individual')).toBe(false);
  });
});
