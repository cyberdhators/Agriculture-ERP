import { z } from 'zod';

import { buyerEmailSchema } from './buyer';
import { phoneSchema } from './phone';

/**
 * "CONTACT CORWADO" (2026-10-21). The owner's choice: a help page with FAQs
 * and a short message form; staff see the messages in a list and mark them
 * done. No tickets, no assignment, no replies, no SLAs -- helpdesk ticketing
 * is out of scope (CLAUDE.md section 2), so there are two statuses and no
 * more. SUPERSEDED 2026-10-28: messages are now support cases, because the
 * specification's line 103 asks for case IDs, responsible staff, evidence,
 * status, dates and resolution (see SUPPORT_STATUSES below). Still no SLAs,
 * no automatic routing and no email threading.
 *
 * A visitor (no sign-in) must leave a phone or an email. That is checked by
 * the route, which is the only place that knows whether a session exists.
 */

/**
 * 2026-10-26 (CORWADO's acceptance test, "review appeal and restore"):
 * 'appeal' -- "Appeal a decision". An appeal is a support MESSAGE like any
 * other (no ticket, no thread); staff see appeals on their own and, when the
 * account can be identified, a link to the record where Restore is. A
 * suspended person is signed out, so a visitor may appeal with their phone.
 */
export const SUPPORT_TOPICS = [
  'account',
  'marketplace',
  'messages',
  'technical',
  'appeal',
  'other',
] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];

/**
 * 2026-10-28 -- SUPPORT CASES (CORWADO's 16 October specification, line 103:
 * "Reports and Support: Case IDs, responsible staff, evidence, status, dates
 * and resolution. Handle technical issues, complaints and appeals."). A
 * message from the help page is a CASE: a visible number, a type, a priority,
 * the staff member responsible, a status, staff replies the person reads in
 * the app, internal notes and evidence links, and a resolution note. This
 * follows the specification's line even though the 2026-10-21 note above
 * said "no tickets" (docs/DECISIONS.md, "Support cases").
 *
 * Statuses: new -> in progress -> waiting (for the person) -> resolved or
 * closed. The earlier 'done' is still a stored value and reads as resolved.
 */
export const SUPPORT_STATUSES = ['new', 'in_progress', 'waiting', 'resolved', 'closed'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

/** What the database may hold: the statuses, plus the earlier 'done'. */
export type StoredSupportStatus = SupportStatus | 'done';

/** A case still being worked on. */
export const OPEN_SUPPORT_STATUSES = ['new', 'in_progress', 'waiting'] as const;

export const SUPPORT_STATUS_LABELS: Readonly<Record<SupportStatus, string>> = {
  new: 'New',
  in_progress: 'In progress',
  waiting: 'Waiting for the person',
  resolved: 'Resolved',
  closed: 'Closed',
};

/** The earlier 'done' reads as resolved; every other stored value is itself. */
export const caseStatusOf = (stored: StoredSupportStatus): SupportStatus =>
  stored === 'done' ? 'resolved' : stored;

/** Settled: says by whom and when (handled_by, handled_at). */
export const isSettledStatus = (status: StoredSupportStatus): boolean =>
  status === 'done' || status === 'resolved' || status === 'closed';

export const CASE_TYPES = ['technical', 'complaint', 'appeal', 'enquiry'] as const;
export type CaseType = (typeof CASE_TYPES)[number];

export const CASE_TYPE_LABELS: Readonly<Record<CaseType, string>> = {
  technical: 'Technical issue',
  complaint: 'Complaint',
  appeal: 'Appeal',
  enquiry: 'Enquiry',
};

/**
 * The type a case has until staff set one: an appeal is an appeal, "something
 * is not working" is a technical issue, anything else is an enquiry. A
 * complaint is a judgement staff make (there is no complaint topic).
 */
export function defaultCaseType(topic: SupportTopic): CaseType {
  if (topic === 'appeal') return 'appeal';
  if (topic === 'technical') return 'technical';
  return 'enquiry';
}

export const CASE_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type CasePriority = (typeof CASE_PRIORITIES)[number];

export const CASE_PRIORITY_LABELS: Readonly<Record<CasePriority, string>> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
};

/** What staff add to a case. Only a reply is ever shown to the person. */
export const CASE_ENTRY_KINDS = ['reply', 'note', 'evidence'] as const;
export type CaseEntryKind = (typeof CASE_ENTRY_KINDS)[number];

/** The visible case ID: "#1045". */
export const caseLabel = (caseNumber: number | string): string => `#${caseNumber}`;

/** Lengths; the database checks the same ones. */
export const SUPPORT_LIMITS = { nameMin: 2, nameMax: 120, bodyMin: 10, bodyMax: 2000 } as const;

/** Messages one sender may send in a day: the brake on a flooded inbox. */
export const SUPPORT_MESSAGES_PER_DAY = 5;

// Each pinned in docs/api/CONVENTIONS.md §5.2.3
export const SUPPORT_MESSAGES = {
  nameLength: 'Give your name, 2 to 120 characters.',
  topicUnknown: 'Choose account, marketplace, messages, technical, appeal or other.',
  bodyLength: 'Write your message, 10 to 2000 characters.',
  // 2026-10-28: support cases.
  statusUnknown: 'Choose new, in progress, waiting, resolved or closed.',
  caseTypeUnknown: 'Choose technical issue, complaint, appeal or enquiry.',
  priorityUnknown: 'Choose low, normal, high or urgent.',
  assigneeMalformed: 'Choose a staff member from the list.',
  resolutionLength: 'Write the resolution in 1 to 2000 characters.',
  nothingToChange: 'Choose something to change.',
  entryKindUnknown: 'Choose reply, note or evidence.',
  entryBodyLength: 'Write 1 to 2000 characters.',
  linkInvalid: 'Give a web address starting http:// or https://, at most 500 characters.',
  evidenceNeedsLink: 'Evidence needs a link.',
  searchLength: 'Search with at most 120 characters.',
} as const;

const S = SUPPORT_MESSAGES;

/** The help-page form. Blank optional fields are left out, not sent empty. */
export const supportMessageSchema = z.strictObject({
  name: z
    .string({ error: () => S.nameLength })
    .trim()
    .min(SUPPORT_LIMITS.nameMin, S.nameLength)
    .max(SUPPORT_LIMITS.nameMax, S.nameLength),
  phone: phoneSchema.optional(),
  email: buyerEmailSchema.optional(),
  topic: z.enum(SUPPORT_TOPICS, { error: () => S.topicUnknown }),
  body: z
    .string({ error: () => S.bodyLength })
    .trim()
    .min(SUPPORT_LIMITS.bodyMin, S.bodyLength)
    .max(SUPPORT_LIMITS.bodyMax, S.bodyLength),
});
export type SupportMessageInput = z.infer<typeof supportMessageSchema>;

/** The staff list's query string. */
export const supportFilterSchema = z.strictObject({
  // 2026-10-28: a case status, or 'open' for new + in progress + waiting.
  status: z.enum([...SUPPORT_STATUSES, 'open'], { error: () => S.statusUnknown }).optional(),
  // 2026-10-26: the Appeals view.
  topic: z.enum(SUPPORT_TOPICS, { error: () => S.topicUnknown }).optional(),
  case_type: z.enum(CASE_TYPES, { error: () => S.caseTypeUnknown }).optional(),
  priority: z.enum(CASE_PRIORITIES, { error: () => S.priorityUnknown }).optional(),
  /** 'me', 'none' (nobody responsible yet) or a staff member's id. */
  assignee: z
    .union([z.enum(['me', 'none']), z.string().uuid()], { error: () => S.assigneeMalformed })
    .optional(),
  /** A case number ("1045" or "#1045") or part of the sender's name. */
  q: z.string({ error: () => S.searchLength }).trim().max(120, S.searchLength).optional(),
  limit: z.string().optional(),
  cursor: z.string().optional(),
});
export type SupportFilter = z.infer<typeof supportFilterSchema>;

/** "#1045" or "1045" is a case number; anything else searches names. */
export function caseNumberQuery(q: string): number | null {
  const m = /^#?\s*(\d{1,12})$/.exec(q.trim());
  return m ? Number(m[1]) : null;
}

const resolutionNote = z
  .string({ error: () => S.resolutionLength })
  .trim()
  .min(1, S.resolutionLength)
  .max(2000, S.resolutionLength);

/** A staff change to a case: any of these, at least one. */
export const supportCaseUpdateSchema = z
  .strictObject({
    status: z.enum(SUPPORT_STATUSES, { error: () => S.statusUnknown }).optional(),
    case_type: z.enum(CASE_TYPES, { error: () => S.caseTypeUnknown }).optional(),
    priority: z.enum(CASE_PRIORITIES, { error: () => S.priorityUnknown }).optional(),
    assignee_id: z
      .string({ error: () => S.assigneeMalformed })
      .uuid(S.assigneeMalformed)
      .nullable()
      .optional(),
    resolution_note: resolutionNote.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: S.nothingToChange,
    path: ['status'],
  });
export type SupportCaseUpdate = z.infer<typeof supportCaseUpdateSchema>;

/** A link: http(s), at most 500 characters. */
export const caseLinkSchema = z
  .string({ error: () => S.linkInvalid })
  .trim()
  .max(500, S.linkInvalid)
  .regex(/^https?:\/\/\S+$/i, S.linkInvalid);

/** A reply to the person, an internal note, or evidence (a link with a line about it). */
export const supportCaseEntrySchema = z
  .strictObject({
    kind: z.enum(CASE_ENTRY_KINDS, { error: () => S.entryKindUnknown }),
    body: z
      .string({ error: () => S.entryBodyLength })
      .trim()
      .min(1, S.entryBodyLength)
      .max(2000, S.entryBodyLength),
    link: caseLinkSchema.optional(),
    /** With a reply: move the case on at the same time (usually to waiting). */
    status: z.enum(SUPPORT_STATUSES, { error: () => S.statusUnknown }).optional(),
  })
  .refine((v) => v.kind !== 'evidence' || v.link !== undefined, {
    message: S.evidenceNeedsLink,
    path: ['link'],
  });
export type SupportCaseEntryInput = z.infer<typeof supportCaseEntrySchema>;

/**
 * What a change does to the case's status, decided before the database is
 * asked. Pure, so the rules are tested without one:
 *  - nothing goes back to 'new' (it means "nobody has looked yet");
 *  - resolving or closing needs a resolution note, already there or sent now;
 *  - a settled case may be reopened (in progress or waiting), which clears who
 *    settled it and when;
 *  - the same status again is no change.
 */
export type CaseTransition =
  | {
      readonly ok: true;
      readonly settles: boolean;
      readonly reopens: boolean;
      readonly same: boolean;
    }
  | {
      readonly ok: false;
      readonly rule: 'support_case_no_back_to_new' | 'support_case_resolution_required';
    };

export function caseTransition(
  from: StoredSupportStatus,
  to: SupportStatus,
  hasResolutionNote: boolean,
): CaseTransition {
  const current = caseStatusOf(from);
  if (current === to) return { ok: true, settles: false, reopens: false, same: true };
  if (to === 'new') return { ok: false, rule: 'support_case_no_back_to_new' };
  const settles = to === 'resolved' || to === 'closed';
  if (settles && !hasResolutionNote) return { ok: false, rule: 'support_case_resolution_required' };
  return { ok: true, settles, reopens: !settles && isSettledStatus(from), same: false };
}

/** One message as the staff list shows it. */
export interface SupportMessage {
  id: string;
  /** 2026-10-28: the visible case ID's number (shown as "#1045"). */
  case_number: number;
  case_type: CaseType;
  priority: CasePriority;
  /** The responsible staff member, or null. */
  assignee: { id: string; name: string } | null;
  resolution_note: string | null;
  updated_at: string;
  from_kind: 'farmer' | 'buyer' | 'visitor';
  name: string;
  phone: string | null;
  email: string | null;
  topic: SupportTopic;
  body: string;
  /** The earlier 'done' is served as 'resolved'. */
  status: SupportStatus;
  /** When the case was resolved or closed. */
  handled_at: string | null;
  created_at: string;
  /**
   * 2026-10-26: for an APPEAL only, the account it is about, when it can be
   * told: the sender's own sign-in, or a visitor's phone carried by exactly
   * one farmer or one buyer record. Where staff open the record and Restore.
   * Null for every other topic, and when nobody or more than one matches.
   */
  account: SupportAccountLink | null;
}

/** One thing staff added to a case. */
export interface SupportCaseEntry {
  id: string;
  kind: CaseEntryKind;
  body: string;
  link: string | null;
  author: { id: string; name: string };
  created_at: string;
}

/** One case with everything on it, for the staff case page. */
export interface SupportCaseDetail extends SupportMessage {
  entries: SupportCaseEntry[];
  /** Who may be made responsible: staff who can handle support. */
  assignable: { id: string; name: string }[];
}

/**
 * One of the person's own cases, as the Help page shows it to them: the
 * number, their topic, where it stands, and staff REPLIES only -- never an
 * internal note, evidence, a staff member's name or the priority.
 */
export interface OwnSupportCase {
  id: string;
  case_number: number;
  topic: SupportTopic;
  status: SupportStatus;
  body: string;
  created_at: string;
  updated_at: string;
  replies: { body: string; created_at: string }[];
}

export interface SupportAccountLink {
  kind: 'farmer' | 'buyer';
  id: string;
  /** A buyer's organisation standing, which names the Buyer accounts tab it is on. */
  buyer_standing: string | null;
  suspended: boolean;
  /** 'sign_in' when the sender was signed in; 'phone' when matched by a visitor's phone. */
  matched_by: 'sign_in' | 'phone';
}
