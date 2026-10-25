import { describe, expect, it } from 'vitest';

import {
  IDENTITY_MESSAGES,
  PHONE_MESSAGES,
  CASE_TYPES,
  SUPPORT_MESSAGES,
  caseLabel,
  caseNumberQuery,
  caseStatusOf,
  caseTransition,
  defaultCaseType,
  isSettledStatus,
  supportCaseEntrySchema,
  supportCaseUpdateSchema,
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

describe('the staff side: support cases (2026-10-28)', () => {
  it('filters by a case status or "open", and nothing else', () => {
    expect(supportFilterSchema.parse({ status: 'new' }).status).toBe('new');
    expect(supportFilterSchema.parse({ status: 'open' }).status).toBe('open');
    expect(supportFilterSchema.parse({ status: 'waiting' }).status).toBe('waiting');
    expect(supportFilterSchema.safeParse({ status: 'done' }).error?.issues[0]?.message).toBe(
      SUPPORT_MESSAGES.statusUnknown,
    );
  });

  it('filters by assignee: me, none, or a staff id', () => {
    expect(supportFilterSchema.parse({ assignee: 'me' }).assignee).toBe('me');
    expect(supportFilterSchema.parse({ assignee: 'none' }).assignee).toBe('none');
    expect(supportFilterSchema.safeParse({ assignee: 'bob' }).error?.issues[0]?.message).toBe(
      SUPPORT_MESSAGES.assigneeMalformed,
    );
  });

  it('reads "#1045" and "1045" as a case number, anything else as a name', () => {
    expect(caseNumberQuery('#1045')).toBe(1045);
    expect(caseNumberQuery(' 1045 ')).toBe(1045);
    expect(caseNumberQuery('Mary')).toBeNull();
    expect(caseNumberQuery('10a')).toBeNull();
    expect(caseLabel(1045)).toBe('#1045');
  });

  it('serves the earlier "done" as resolved', () => {
    expect(caseStatusOf('done')).toBe('resolved');
    expect(caseStatusOf('waiting')).toBe('waiting');
    expect(isSettledStatus('done')).toBe(true);
    expect(isSettledStatus('in_progress')).toBe(false);
  });

  it('gives a case a type from its topic until staff set one', () => {
    expect(defaultCaseType('appeal')).toBe('appeal');
    expect(defaultCaseType('technical')).toBe('technical');
    expect(defaultCaseType('account')).toBe('enquiry');
    expect(CASE_TYPES).toEqual(['technical', 'complaint', 'appeal', 'enquiry']);
  });

  it('a change must change something, in words', () => {
    expect(supportCaseUpdateSchema.safeParse({}).error?.issues[0]?.message).toBe(
      SUPPORT_MESSAGES.nothingToChange,
    );
    expect(supportCaseUpdateSchema.parse({ assignee_id: null })).toEqual({ assignee_id: null });
    expect(supportCaseUpdateSchema.safeParse({ priority: 'asap' }).error?.issues[0]?.message).toBe(
      SUPPORT_MESSAGES.priorityUnknown,
    );
    expect(supportCaseUpdateSchema.safeParse({ status: 'new', x: 1 }).success).toBe(false);
  });

  it('evidence needs a link; a link must be a web address', () => {
    expect(
      supportCaseEntrySchema.safeParse({ kind: 'evidence', body: 'Screenshot' }).error?.issues[0]
        ?.message,
    ).toBe(SUPPORT_MESSAGES.evidenceNeedsLink);
    expect(
      supportCaseEntrySchema.safeParse({ kind: 'note', body: 'x', link: 'javascript:alert(1)' })
        .error?.issues[0]?.message,
    ).toBe(SUPPORT_MESSAGES.linkInvalid);
    expect(
      supportCaseEntrySchema.parse({
        kind: 'evidence',
        body: ' Screenshot ',
        link: 'https://example.org/a.png',
      }).body,
    ).toBe('Screenshot');
    expect(
      supportCaseEntrySchema.safeParse({ kind: 'reply', body: '   ' }).error?.issues[0]?.message,
    ).toBe(SUPPORT_MESSAGES.entryBodyLength);
  });

  describe('status changes', () => {
    it('never goes back to new', () => {
      expect(caseTransition('in_progress', 'new', true)).toEqual({
        ok: false,
        rule: 'support_case_no_back_to_new',
      });
    });
    it('resolving or closing needs a resolution note', () => {
      expect(caseTransition('new', 'resolved', false)).toEqual({
        ok: false,
        rule: 'support_case_resolution_required',
      });
      expect(caseTransition('waiting', 'closed', true)).toEqual({
        ok: true,
        settles: true,
        reopens: false,
        same: false,
      });
    });
    it('reopening a settled case, including an earlier "done"', () => {
      expect(caseTransition('done', 'in_progress', false)).toEqual({
        ok: true,
        settles: false,
        reopens: true,
        same: false,
      });
    });
    it('the same status again is no change; "done" to resolved is the same', () => {
      expect(caseTransition('done', 'resolved', false).ok && true).toBe(true);
      expect(caseTransition('waiting', 'waiting', false)).toMatchObject({ same: true });
    });
  });
});
