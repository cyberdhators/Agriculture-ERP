import { z } from 'zod';

import {
  ADVICE_CASE_STATUSES,
  ADVICE_OUTCOMES_BY_SIDE,
  type AdviceCaseStatus,
  type AdviceContactMode,
  type AdviceOutcome,
} from './advice';
import { type AdviceTopic } from './advice-topics';
import { BUYER_MESSAGES } from './buyer';

/**
 * ORGANISATION ADVICE CASES (2026-10-28). CORWADO's specification, infographic
 * 8 panel 3: "Requests go directly to the provider's authorized staff, who
 * manage the conversation" -- an institution's shared inbox, its authorised
 * staff, Assign, Accept, Respond, Close. docs/DECISIONS.md, "Organisation
 * advice cases (2026-10-28)".
 *
 * An organisation may have ONE advice profile (advice_provider.organization_id),
 * separate from any member's personal profile. A request to it lands in the
 * organisation's SHARED ADVICE INBOX, which only active members holding
 * `advisory.handle` can open (an administrator holds every permission). The
 * requester still sees one case and one private conversation, with the
 * organisation's profile name -- never a member's.
 *
 * WHO DOES WHAT (orgAdviceDecision below, the one place it is decided):
 *   claim    any handler takes an UNASSIGNED case for themselves: assigned to
 *            them and accepted at once; open -> in progress
 *   assign   an ADMINISTRATOR gives a case to a member who holds
 *            advisory.handle (themselves included: that is a claim)
 *   accept   the assignee takes up a case given to them: open -> in progress
 *   release  the assignee (or an administrator) hands it back, unassigned
 *   close    the accepted assignee (or an administrator) closes it with a
 *            provider's outcome: referred or closed unresolved
 * Replying needs the same as closing (mayReplyOrgAdvice): the case is not a
 * broadcast, and only the person handling it speaks for the organisation.
 *
 * Access is re-checked on every request: a member removed, or whose
 * advisory.handle is taken away, cannot open the inbox on the next request,
 * and a case assigned to them can be reassigned by an administrator.
 */

export const ORG_ADVICE_ACTIONS = ['claim', 'assign', 'accept', 'release', 'close'] as const;
export type OrgAdviceAction = (typeof ORG_ADVICE_ACTIONS)[number];

/** The outcomes the organisation may close with: the provider's side. */
export const ORG_ADVICE_OUTCOMES = ADVICE_OUTCOMES_BY_SIDE.provider;

// ---------------------------------------------------------------------------
// MESSAGES -- each pinned in docs/api/CONVENTIONS.md §5.2.3
// ---------------------------------------------------------------------------

export const ORG_ADVICE_MESSAGES = {
  actionUnknown: 'Choose claim, assign, accept, release or close.',
  memberRequired: 'Choose the member to assign this request to.',
  outcomeUnknown: 'Choose referred or closed unresolved.',
  fieldNotForAction: 'This field is not used for that change.',
  statusUnknown: 'Choose open, in progress or closed.',
} as const;

const M = ORG_ADVICE_MESSAGES;

const idSchema = z
  .string({ error: () => BUYER_MESSAGES.identifierMalformed })
  .uuid(BUYER_MESSAGES.identifierMalformed);

/** GET /api/organizations/:id/advice-cases?status= -- one tab of the inbox. */
export const orgAdviceListSchema = z.strictObject({
  status: z.enum(ADVICE_CASE_STATUSES, { error: () => M.statusUnknown }).default('open'),
});

/**
 * POST /api/organizations/:id/advice-cases/:caseId/action. `member_id` is the
 * organisation_member row id (never a sign-in id) and only for `assign`;
 * `outcome` only for `close`.
 */
export const orgAdviceActionSchema = z
  .strictObject({
    action: z.enum(ORG_ADVICE_ACTIONS, { error: () => M.actionUnknown }),
    member_id: idSchema.optional(),
    outcome: z
      .enum(ORG_ADVICE_OUTCOMES as unknown as [AdviceOutcome, ...AdviceOutcome[]], {
        error: () => M.outcomeUnknown,
      })
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === 'assign' && value.member_id === undefined) {
      ctx.addIssue({ code: 'custom', path: ['member_id'], message: M.memberRequired });
    }
    if (value.action !== 'assign' && value.member_id !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['member_id'], message: M.fieldNotForAction });
    }
    if (value.action === 'close' && value.outcome === undefined) {
      ctx.addIssue({ code: 'custom', path: ['outcome'], message: M.outcomeUnknown });
    }
    if (value.action !== 'close' && value.outcome !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['outcome'], message: M.fieldNotForAction });
    }
  });
export type OrgAdviceActionInput = z.infer<typeof orgAdviceActionSchema>;

// ---------------------------------------------------------------------------
// THE DECISION -- pure
// ---------------------------------------------------------------------------

export interface OrgAdviceCaseState {
  readonly status: AdviceCaseStatus;
  /** The assignee's sign-in, or null. */
  readonly assignee: string | null;
  readonly accepted: boolean;
}

export interface OrgAdviceCaller {
  /** The caller's sign-in. */
  readonly person: string;
  /** Holds advisory.handle (an administrator always does). */
  readonly handles: boolean;
  /** Is an administrator of the organisation. */
  readonly administrator: boolean;
}

/** The rule keys a refusal names (RULE_MESSAGES in apps/web/lib/api/errors.ts). */
export type OrgAdviceRule =
  | 'advice_case_closed'
  | 'org_advice_admin_only'
  | 'org_advice_assignee_invalid'
  | 'org_advice_already_assigned'
  | 'org_advice_not_assignee'
  | 'org_advice_accept_first';

export type OrgAdviceOutcome =
  | { readonly ok: true; readonly changed: boolean; readonly next: OrgAdviceCaseState }
  | { readonly ok: false; readonly rule: OrgAdviceRule | 'forbidden' };

/**
 * What one action does to one case. `target` is the member an administrator
 * assigns to: their sign-in and whether they hold advisory.handle now. A
 * repeat of a change already made is `changed: false`, never a refusal.
 */
export function orgAdviceDecision(input: {
  readonly action: OrgAdviceAction;
  readonly caller: OrgAdviceCaller;
  readonly current: OrgAdviceCaseState;
  readonly target?: { readonly person: string; readonly handles: boolean } | null;
}): OrgAdviceOutcome {
  const { action, caller, current } = input;
  if (!caller.handles) return { ok: false, rule: 'forbidden' };
  if (current.status === 'closed') {
    return action === 'close' && (caller.administrator || current.assignee === caller.person)
      ? { ok: true, changed: false, next: current }
      : { ok: false, rule: 'advice_case_closed' };
  }
  const started = (s: AdviceCaseStatus): AdviceCaseStatus => (s === 'open' ? 'in_progress' : s);
  const same = (next: OrgAdviceCaseState) =>
    next.status === current.status &&
    next.assignee === current.assignee &&
    next.accepted === current.accepted;
  const done = (next: OrgAdviceCaseState): OrgAdviceOutcome => ({
    ok: true,
    changed: !same(next),
    next,
  });

  switch (action) {
    case 'claim': {
      if (current.assignee !== null && current.assignee !== caller.person) {
        return { ok: false, rule: 'org_advice_already_assigned' };
      }
      return done({ status: started(current.status), assignee: caller.person, accepted: true });
    }
    case 'assign': {
      if (!caller.administrator) return { ok: false, rule: 'org_advice_admin_only' };
      const target = input.target;
      if (!target || !target.handles) return { ok: false, rule: 'org_advice_assignee_invalid' };
      if (target.person === caller.person) {
        return done({ status: started(current.status), assignee: caller.person, accepted: true });
      }
      if (current.assignee === target.person) return done(current);
      // A new assignee starts unaccepted; the case keeps its status.
      return done({ status: current.status, assignee: target.person, accepted: false });
    }
    case 'accept': {
      if (current.assignee !== caller.person) return { ok: false, rule: 'org_advice_not_assignee' };
      return done({ status: started(current.status), assignee: caller.person, accepted: true });
    }
    case 'release': {
      if (current.assignee === null) return done(current);
      if (current.assignee !== caller.person && !caller.administrator) {
        return { ok: false, rule: 'org_advice_not_assignee' };
      }
      return done({ status: current.status, assignee: null, accepted: false });
    }
    case 'close': {
      if (!caller.administrator) {
        if (current.assignee !== caller.person)
          return { ok: false, rule: 'org_advice_not_assignee' };
        if (!current.accepted) return { ok: false, rule: 'org_advice_accept_first' };
      }
      return done({ status: 'closed', assignee: current.assignee, accepted: current.accepted });
    }
    default: {
      const never: never = action;
      return never;
    }
  }
}

/** Whether the caller may write in the case's conversation for the organisation. */
export function mayReplyOrgAdvice(
  caller: OrgAdviceCaller,
  current: OrgAdviceCaseState,
): OrgAdviceRule | 'forbidden' | null {
  if (!caller.handles) return 'forbidden';
  if (current.status === 'closed') return 'advice_case_closed';
  if (caller.administrator) return null;
  if (current.assignee !== caller.person) return 'org_advice_not_assignee';
  if (!current.accepted) return 'org_advice_accept_first';
  return null;
}

// ---------------------------------------------------------------------------
// WHAT LEAVES THE API
// ---------------------------------------------------------------------------

/** One case in an organisation's advice inbox, for its handlers only. */
export interface OrgAdviceCaseView {
  id: string;
  provider: { id: string; display_name: string };
  requester_name: string;
  topic: AdviceTopic;
  question: string;
  preferred_contact: AdviceContactMode;
  share_details: boolean;
  status: AdviceCaseStatus;
  outcome: AdviceOutcome | null;
  /** The member handling it ("Mary K."), or null. Never a phone. */
  assigned_to: { member_id: string | null; name: string; is_me: boolean } | null;
  accepted: boolean;
  /** What the caller may do now; the server decides again on each action. */
  may: {
    claim: boolean;
    assign: boolean;
    accept: boolean;
    release: boolean;
    reply: boolean;
    close: boolean;
  };
  unread: boolean;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A member who can be given cases: holds advisory.handle now. */
export interface OrgAdviceHandler {
  member_id: string;
  name: string;
  is_me: boolean;
}

/** Which actions the caller could take now -- the screen's buttons. */
export function orgAdviceMay(
  caller: OrgAdviceCaller,
  current: OrgAdviceCaseState,
): OrgAdviceCaseView['may'] {
  const can = (action: OrgAdviceAction, target?: { person: string; handles: boolean }) => {
    const out = orgAdviceDecision({ action, caller, current, target: target ?? null });
    return out.ok && out.changed;
  };
  return {
    claim: current.assignee === null && can('claim'),
    // Shown when an administrator could give it to someone; the target is chosen later.
    assign: caller.administrator && caller.handles && current.status !== 'closed',
    accept: current.assignee === caller.person && !current.accepted && can('accept'),
    release: current.assignee !== null && can('release'),
    reply: mayReplyOrgAdvice(caller, current) === null,
    close: current.status !== 'closed' && can('close'),
  };
}
