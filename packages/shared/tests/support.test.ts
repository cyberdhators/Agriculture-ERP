import { describe, expect, it } from 'vitest';

import {
  IDENTITY_MESSAGES,
  PHONE_MESSAGES,
  SUPPORT_MESSAGES,
  supportDoneSchema,
  supportFilterSchema,
  supportMessageSchema,
} from '../src';

const valid = {
  name: '  Mary Kuol ',
  topic: 'account',
  body: '  I cannot sign in on my new phone.  ',
};

describe('the help-page form', () => {
  it('accepts a message with no contact (the route asks a visitor for one)', () => {
    const parsed = supportMessageSchema.parse(valid);
    expect(parsed.name).toBe('Mary Kuol');
    expect(parsed.body).toBe('I cannot sign in on my new phone.');
    expect(parsed.phone).toBeUndefined();
  });

  it('normalises a phone and an email', () => {
    const parsed = supportMessageSchema.parse({
      ...valid,
      phone: '0912 345 678',
      email: ' Mary@Example.org ',
    });
    expect(parsed.phone).toBe('+211912345678');
    expect(parsed.email).toBe('mary@example.org');
  });

  it('refuses each field in our own words', () => {
    const reasons = (input: Record<string, unknown>) =>
      supportMessageSchema.safeParse(input).error?.issues.map((i) => i.message) ?? [];
    expect(reasons({ ...valid, name: 'M' })).toEqual([SUPPORT_MESSAGES.nameLength]);
    expect(reasons({ ...valid, topic: 'billing' })).toEqual([SUPPORT_MESSAGES.topicUnknown]);
    expect(reasons({ ...valid, body: 'Help' })).toEqual([SUPPORT_MESSAGES.bodyLength]);
    expect(reasons({ ...valid, body: 'x'.repeat(2001) })).toEqual([SUPPORT_MESSAGES.bodyLength]);
    expect(reasons({ ...valid, phone: '12' })).toEqual([PHONE_MESSAGES.wrongCountry]);
    expect(reasons({ ...valid, email: 'nope' })).toEqual([IDENTITY_MESSAGES.emailInvalid]);
  });

  it('refuses a field it does not know, such as a status', () => {
    expect(supportMessageSchema.safeParse({ ...valid, status: 'done' }).success).toBe(false);
  });
});

describe('the staff side', () => {
  it('can only mark a message done', () => {
    expect(supportDoneSchema.parse({ status: 'done' })).toEqual({ status: 'done' });
    expect(supportDoneSchema.safeParse({ status: 'new' }).error?.issues[0]?.message).toBe(
      SUPPORT_MESSAGES.doneOnly,
    );
  });

  it('filters by new or done only', () => {
    expect(supportFilterSchema.parse({ status: 'new' }).status).toBe('new');
    expect(supportFilterSchema.safeParse({ status: 'open' }).error?.issues[0]?.message).toBe(
      SUPPORT_MESSAGES.statusUnknown,
    );
  });
});
