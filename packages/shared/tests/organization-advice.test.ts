import { describe, expect, it } from 'vitest';

import {
  mayReplyOrgAdvice,
  orgAdviceActionSchema,
  orgAdviceDecision,
  orgAdviceListSchema,
  orgAdviceMay,
  type OrgAdviceCaller,
  type OrgAdviceCaseState,
} from '../src/organization-advice';

const ADMIN: OrgAdviceCaller = { person: 'admin', handles: true, administrator: true };
const MARY: OrgAdviceCaller = { person: 'mary', handles: true, administrator: false };
const VIEWER: OrgAdviceCaller = { person: 'vic', handles: false, administrator: false };

const OPEN: OrgAdviceCaseState = { status: 'open', assignee: null, accepted: false };
const GIVEN_TO_MARY: OrgAdviceCaseState = { status: 'open', assignee: 'mary', accepted: false };
const MARYS: OrgAdviceCaseState = { status: 'in_progress', assignee: 'mary', accepted: true };
const CLOSED: OrgAdviceCaseState = { status: 'closed', assignee: 'mary', accepted: true };

const ID = '6f1c1e4a-1b2c-4d3e-8f90-123456789abc';

describe('orgAdviceActionSchema', () => {
  it('needs a member for assign and an outcome for close', () => {
    expect(orgAdviceActionSchema.safeParse({ action: 'assign' }).success).toBe(false);
    expect(orgAdviceActionSchema.safeParse({ action: 'assign', member_id: ID }).success).toBe(true);
    expect(orgAdviceActionSchema.safeParse({ action: 'close' }).success).toBe(false);
    expect(
      orgAdviceActionSchema.safeParse({ action: 'close', outcome: 'closed_unresolved' }).success,
    ).toBe(true);
  });

  it("refuses the requester's outcomes and fields that do not belong", () => {
    expect(orgAdviceActionSchema.safeParse({ action: 'close', outcome: 'resolved' }).success).toBe(
      false,
    );
    expect(orgAdviceActionSchema.safeParse({ action: 'claim', member_id: ID }).success).toBe(false);
    expect(orgAdviceActionSchema.safeParse({ action: 'accept', outcome: 'referred' }).success).toBe(
      false,
    );
    expect(orgAdviceActionSchema.safeParse({ action: 'take' }).success).toBe(false);
  });

  it('lists one status, open by default', () => {
    expect(orgAdviceListSchema.parse({}).status).toBe('open');
    expect(orgAdviceListSchema.safeParse({ status: 'all' }).success).toBe(false);
  });
});

describe('orgAdviceDecision', () => {
  it('refuses anyone without advisory.handle, whatever they ask', () => {
    for (const action of ['claim', 'assign', 'accept', 'release', 'close'] as const) {
      expect(orgAdviceDecision({ action, caller: VIEWER, current: OPEN })).toEqual({
        ok: false,
        rule: 'forbidden',
      });
    }
  });

  it('a handler claims an unassigned case: assigned, accepted, in progress', () => {
    const out = orgAdviceDecision({ action: 'claim', caller: MARY, current: OPEN });
    expect(out).toEqual({ ok: true, changed: true, next: MARYS });
  });

  it('a case someone else holds cannot be claimed', () => {
    const out = orgAdviceDecision({ action: 'claim', caller: ADMIN, current: MARYS });
    expect(out).toEqual({ ok: false, rule: 'org_advice_already_assigned' });
  });

  it('only an administrator assigns, and only to a member who handles advice', () => {
    expect(
      orgAdviceDecision({
        action: 'assign',
        caller: MARY,
        current: OPEN,
        target: { person: 'joe', handles: true },
      }),
    ).toEqual({ ok: false, rule: 'org_advice_admin_only' });
    expect(
      orgAdviceDecision({
        action: 'assign',
        caller: ADMIN,
        current: OPEN,
        target: { person: 'vic', handles: false },
      }),
    ).toEqual({ ok: false, rule: 'org_advice_assignee_invalid' });
    expect(orgAdviceDecision({ action: 'assign', caller: ADMIN, current: OPEN })).toEqual({
      ok: false,
      rule: 'org_advice_assignee_invalid',
    });
    expect(
      orgAdviceDecision({
        action: 'assign',
        caller: ADMIN,
        current: OPEN,
        target: { person: 'mary', handles: true },
      }),
    ).toEqual({ ok: true, changed: true, next: GIVEN_TO_MARY });
  });

  it('an administrator assigning to themselves takes it up at once', () => {
    const out = orgAdviceDecision({
      action: 'assign',
      caller: ADMIN,
      current: OPEN,
      target: { person: 'admin', handles: true },
    });
    expect(out).toEqual({
      ok: true,
      changed: true,
      next: { status: 'in_progress', assignee: 'admin', accepted: true },
    });
  });

  it('only the assignee accepts; accepting again changes nothing', () => {
    expect(orgAdviceDecision({ action: 'accept', caller: ADMIN, current: GIVEN_TO_MARY })).toEqual({
      ok: false,
      rule: 'org_advice_not_assignee',
    });
    expect(orgAdviceDecision({ action: 'accept', caller: MARY, current: GIVEN_TO_MARY })).toEqual({
      ok: true,
      changed: true,
      next: MARYS,
    });
    expect(orgAdviceDecision({ action: 'accept', caller: MARY, current: MARYS })).toEqual({
      ok: true,
      changed: false,
      next: MARYS,
    });
  });

  it('the assignee or an administrator releases; nobody else', () => {
    const other: OrgAdviceCaller = { person: 'joe', handles: true, administrator: false };
    expect(orgAdviceDecision({ action: 'release', caller: other, current: MARYS })).toEqual({
      ok: false,
      rule: 'org_advice_not_assignee',
    });
    const released = { status: 'in_progress', assignee: null, accepted: false };
    expect(orgAdviceDecision({ action: 'release', caller: MARY, current: MARYS })).toEqual({
      ok: true,
      changed: true,
      next: released,
    });
    expect(orgAdviceDecision({ action: 'release', caller: ADMIN, current: MARYS })).toEqual({
      ok: true,
      changed: true,
      next: released,
    });
  });

  it('closing needs the accepted assignee or an administrator', () => {
    expect(orgAdviceDecision({ action: 'close', caller: MARY, current: GIVEN_TO_MARY })).toEqual({
      ok: false,
      rule: 'org_advice_accept_first',
    });
    expect(orgAdviceDecision({ action: 'close', caller: MARY, current: OPEN })).toEqual({
      ok: false,
      rule: 'org_advice_not_assignee',
    });
    expect(orgAdviceDecision({ action: 'close', caller: MARY, current: MARYS })).toMatchObject({
      ok: true,
      changed: true,
      next: { status: 'closed' },
    });
    expect(orgAdviceDecision({ action: 'close', caller: ADMIN, current: OPEN })).toMatchObject({
      ok: true,
      next: { status: 'closed' },
    });
  });

  it('a closed case takes nothing but a repeated close', () => {
    for (const action of ['claim', 'accept', 'release'] as const) {
      expect(orgAdviceDecision({ action, caller: MARY, current: CLOSED })).toEqual({
        ok: false,
        rule: 'advice_case_closed',
      });
    }
    expect(orgAdviceDecision({ action: 'close', caller: MARY, current: CLOSED })).toEqual({
      ok: true,
      changed: false,
      next: CLOSED,
    });
  });
});

describe('mayReplyOrgAdvice and orgAdviceMay', () => {
  it('one person speaks for the organisation: the accepted assignee, or an administrator', () => {
    expect(mayReplyOrgAdvice(MARY, MARYS)).toBeNull();
    expect(mayReplyOrgAdvice(ADMIN, MARYS)).toBeNull();
    expect(mayReplyOrgAdvice(MARY, GIVEN_TO_MARY)).toBe('org_advice_accept_first');
    expect(mayReplyOrgAdvice({ person: 'joe', handles: true, administrator: false }, MARYS)).toBe(
      'org_advice_not_assignee',
    );
    expect(mayReplyOrgAdvice(VIEWER, MARYS)).toBe('forbidden');
    expect(mayReplyOrgAdvice(ADMIN, CLOSED)).toBe('advice_case_closed');
  });

  it('offers the buttons the decision would allow', () => {
    expect(orgAdviceMay(MARY, OPEN)).toEqual({
      claim: true,
      assign: false,
      accept: false,
      release: false,
      reply: false,
      close: false,
    });
    expect(orgAdviceMay(MARY, GIVEN_TO_MARY)).toMatchObject({ accept: true, reply: false });
    expect(orgAdviceMay(MARY, MARYS)).toMatchObject({ reply: true, close: true, release: true });
    expect(orgAdviceMay(ADMIN, MARYS)).toMatchObject({ assign: true, claim: false });
    expect(orgAdviceMay(VIEWER, OPEN)).toEqual({
      claim: false,
      assign: false,
      accept: false,
      release: false,
      reply: false,
      close: false,
    });
  });
});
