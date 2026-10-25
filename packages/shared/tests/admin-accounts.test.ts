import { describe, expect, it } from 'vitest';

import {
  ADMIN_ACCOUNT_MESSAGES,
  accountSearch,
  accountStatusOf,
  adminAccountFilterSchema,
  advisoryStatusOf,
  maskEmail,
  maskPhone,
  revealContactSchema,
} from '../src';

describe('the accounts list filter (2026-10-28)', () => {
  it('takes the names the Overview tiles carry', () => {
    expect(
      adminAccountFilterSchema.parse({
        kind: 'organisation',
        sign_in: 'yes',
        actor: 'processor',
        state: 'SS-CE',
        from: '2026-10-01',
        to: '2026-10-28',
      }),
    ).toMatchObject({ kind: 'organisation', sign_in: 'yes', actor: 'processor' });
  });

  it('refuses each field in our own words', () => {
    const reason = (input: Record<string, unknown>) =>
      adminAccountFilterSchema.safeParse(input).error?.issues[0]?.message;
    expect(reason({ kind: 'robot' })).toBe(ADMIN_ACCOUNT_MESSAGES.kindUnknown);
    expect(reason({ sign_in: 'maybe' })).toBe(ADMIN_ACCOUNT_MESSAGES.signInUnknown);
    expect(reason({ actor: 'pirate' })).toBe(ADMIN_ACCOUNT_MESSAGES.actorUnknown);
    expect(reason({ status: 'deleted' })).toBe(ADMIN_ACCOUNT_MESSAGES.statusUnknown);
    expect(reason({ from: '28/10/2026' })).toBe(ADMIN_ACCOUNT_MESSAGES.dateInvalid);
    expect(reason({ q: 'x'.repeat(101) })).toBe(ADMIN_ACCOUNT_MESSAGES.searchLength);
    expect(adminAccountFilterSchema.safeParse({ colour: 'red' }).success).toBe(false);
  });

  it('never lists a deleted account: there is no deleted status to ask for', () => {
    expect(adminAccountFilterSchema.safeParse({ status: 'deleted' }).success).toBe(false);
  });

  it('a reveal names phone or email only', () => {
    expect(revealContactSchema.parse({ field: 'email' })).toEqual({ field: 'email' });
    expect(revealContactSchema.safeParse({ field: 'password' }).error?.issues[0]?.message).toBe(
      ADMIN_ACCOUNT_MESSAGES.contactFieldUnknown,
    );
  });
});

describe('an account status', () => {
  it('disabled outranks suspended, and closed outranks both', () => {
    expect(accountStatusOf({ suspended_at: null, disabled_at: null })).toBe('active');
    expect(accountStatusOf({ suspended_at: '2026-10-01', disabled_at: null })).toBe('suspended');
    expect(accountStatusOf({ suspended_at: '2026-10-01', disabled_at: '2026-10-02' })).toBe(
      'disabled',
    );
    expect(accountStatusOf({ suspended_at: null, disabled_at: null, closed: true })).toBe('closed');
  });
});

describe('advisory status', () => {
  const none = { provider_status: null, adviser_approved: false, application_status: null };
  it('reads approval first, then a waiting application, then the profile', () => {
    expect(advisoryStatusOf(none)).toBe('none');
    expect(advisoryStatusOf({ ...none, provider_status: 'draft' })).toBe('draft');
    expect(advisoryStatusOf({ ...none, provider_status: 'published' })).toBe('published');
    expect(
      advisoryStatusOf({ ...none, provider_status: 'published', application_status: 'submitted' }),
    ).toBe('applied');
    expect(
      advisoryStatusOf({ ...none, provider_status: 'published', application_status: 'declined' }),
    ).toBe('published');
    expect(advisoryStatusOf({ ...none, adviser_approved: true })).toBe('approved');
  });
});

describe('masks', () => {
  it('a phone keeps the country code and the last two digits', () => {
    expect(maskPhone('+211912345678')).toBe('+211 *** *** *78');
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone('12')).toBe('***');
  });
  it('an email keeps its first letter and its domain', () => {
    expect(maskEmail('amina@example.com')).toBe('a****@example.com');
    expect(maskEmail('ab@x.org')).toBe('a***@x.org');
    expect(maskEmail('nope')).toBe('***');
    expect(maskEmail(undefined)).toBeNull();
  });
  it('never contains the middle of the value', () => {
    expect(maskPhone('+211912345678')).not.toContain('123456');
    expect(maskEmail('secretname@example.com')).not.toContain('ecretname');
  });
});

describe('what a search box may match', () => {
  it('digits search a phone only for staff permitted to search by contact', () => {
    expect(accountSearch('0912 345 678', true).digits).toBe('0912345678');
    expect(accountSearch('0912 345 678', false).digits).toBeNull();
    expect(accountSearch('+211 912', true).digits).toBe('211912');
  });
  it('recognises an id; anything else is a name', () => {
    const id = '0f0e0d0c-0b0a-4900-8800-776655443322';
    expect(accountSearch(id.toUpperCase(), false).uuid).toBe(id);
    expect(accountSearch('Amina', true)).toEqual({ uuid: null, digits: null, text: 'Amina' });
  });
});
