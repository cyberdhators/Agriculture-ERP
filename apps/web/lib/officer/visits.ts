import {
  correctVisitSchema,
  recordVisitSchema,
  VISIT_LIMITS,
  VISIT_TOPICS,
  type CorrectVisit,
  type RecordVisit,
  type VisitTopic,
} from '@agri-erp/shared';

import { isRemovedLink, type ChainLink, type Visit } from '@/lib/visits/api';

/**
 * THE OFFICER'S VISIT, AS A MODEL.
 *
 * Every rule here is read off `packages/shared/src/visit.ts` and the B8 routes
 * rather than decided again. Nothing in this file authorises anything: the
 * farmer comes from the URL, the officer from the session, and the server
 * re-checks both.
 *
 * WHAT THE ROUTE REQUIRES, AND WHAT IT MERELY ALLOWS. `recordVisitSchema` makes
 * `id`, `visited_at`, `position`, `gps_accuracy_m`, `advice` and at least one
 * topic mandatory. `observation`, `duration_minutes`, `attendee_count` and
 * `follow_up_of` are optional AND nullable -- so an unanswered one is left OUT
 * rather than sent as null (C-5.8). On a correction the two part company and
 * the difference is the point: a key that is absent is untouched, a key that is
 * null is deliberately cleared.
 *
 * THE FARMER IS NOT IN THE BODY. It is `POST /api/farmers/:id/visits`; there is
 * no `farmer_id` field to tamper with, and a farmer outside the caseload is a
 * 404 from `loadVisible` before the handler runs.
 */
export type { VisitTopic };

/** The nine, in the canonical order. Re-exported, never re-listed. */
export const TOPICS = VISIT_TOPICS;

export interface VisitDraft {
  /** A `datetime-local` value: no zone, which is why `localToIso` exists. */
  visited_at: string;
  advice: string;
  observation: string;
  topics: VisitTopic[];
  duration_minutes: string;
  attendee_count: string;
  /**
   * The id of an earlier visit TO THE SAME FARMER, or '' for none.
   *
   * The route checks the target exists for this farmer and is not removed
   * (422 `follow_up_not_found`), that it is not the visit itself, and that
   * following it back never reaches it (422 `follow_up_cycle`); the
   * `visit_follow_up_guard` trigger refuses all four again underneath.
   * Nothing is judged here beyond the shape -- the screen only ever offers
   * visits the server itself handed it for this farmer.
   */
  follow_up_of: string;
}

/**
 * One GPS reading. The route wants a GeoJSON Point and an accuracy in metres,
 * which is exactly what `navigator.geolocation` hands back -- so this is the
 * device's reading carried across, never a remembered or guessed one.
 */
export interface Fix {
  longitude: number;
  latitude: number;
  accuracy_m: number;
}

export const emptyVisitDraft = (now = new Date()): VisitDraft => ({
  visited_at: toLocalInput(now),
  advice: '',
  observation: '',
  topics: [],
  duration_minutes: '',
  attendee_count: '',
  follow_up_of: '',
});

/** A `datetime-local` value for a moment, in the reader's own zone. */
export function toLocalInput(when: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}T${pad(when.getHours())}:${pad(when.getMinutes())}`;
}

/**
 * A `datetime-local` value carries no zone, so it is read as the phone's own
 * and converted to an absolute moment. The schema wants an offset and `Z` is
 * one. An unparseable value becomes '' and the schema refuses it by name.
 */
export function localToIso(local: string): string {
  if (local.trim() === '') return '';
  const when = new Date(local);
  return Number.isNaN(when.getTime()) ? '' : when.toISOString();
}

const wholeOrUndefined = (raw: string): number | undefined => {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : Number.NaN;
};

/**
 * The body for `POST /api/farmers/:id/visits`.
 *
 * An unanswered optional is OMITTED. Sending `null` would say "there was no
 * observation", which is a different claim from "nobody recorded one".
 */
export function buildVisit(draft: VisitDraft, fix: Fix, newId: () => string): RecordVisit {
  const body: Record<string, unknown> = {
    id: newId(),
    visited_at: localToIso(draft.visited_at),
    position: { type: 'Point', coordinates: [fix.longitude, fix.latitude] },
    gps_accuracy_m: fix.accuracy_m,
    advice: draft.advice.trim(),
    topics: draft.topics,
  };
  const observation = draft.observation.trim();
  if (observation !== '') body.observation = observation;
  const duration = wholeOrUndefined(draft.duration_minutes);
  if (duration !== undefined) body.duration_minutes = duration;
  const attendees = wholeOrUndefined(draft.attendee_count);
  if (attendees !== undefined) body.attendee_count = attendees;
  // A visit that follows nothing sends NO KEY -- absent, not a null claiming
  // "this deliberately follows nothing".
  if (draft.follow_up_of !== '') body.follow_up_of = draft.follow_up_of;
  return body as RecordVisit;
}

export interface Problem {
  field: string;
  message: string;
}

/**
 * What is still wrong, IN THE SHARED SCHEMA'S OWN WORDS.
 *
 * The body is built and handed to `recordVisitSchema`, so this screen cannot
 * disagree with the API about what is valid -- there is no second copy of the
 * rules to drift. The one thing the schema cannot speak to is a reading that
 * was never taken, because without it there is no body to parse at all.
 */
export function visitProblems(draft: VisitDraft, fix: Fix | null): Problem[] {
  if (!fix) {
    return [
      {
        field: 'position',
        message: 'Take the GPS reading before saving. A visit records where it happened.',
      },
    ];
  }
  const parsed = recordVisitSchema.safeParse(buildVisit(draft, fix, () => PLACEHOLDER_ID));
  if (parsed.success) return [];
  const seen = new Set<string>();
  const problems: Problem[] = [];
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0] ?? 'form');
    if (seen.has(field)) continue;
    seen.add(field);
    problems.push({ field, message: issue.message });
  }
  return problems;
}

/** Only ever handed to the validator; the real id is minted at submit. */
const PLACEHOLDER_ID = '00000000-0000-4000-8000-000000000000';

export const toggleTopic = (topics: readonly VisitTopic[], topic: VisitTopic): VisitTopic[] =>
  topics.includes(topic) ? topics.filter((t) => t !== topic) : [...topics, topic];

/* ---- Correcting, within the window the SERVER keeps ------------------- */

export interface CorrectionState {
  /** The officer recorded it AND the server's window is still open. */
  canCorrect: boolean;
  reason: 'open' | 'not_mine' | 'closed';
  closesAt: string | null;
}

/**
 * MIRRORS `withinCorrectionWindow`, WHICH IS THE ONE THAT DECIDES.
 *
 * The server measures twenty-four hours from `received_at` -- ITS OWN moment of
 * receipt, not `visited_at`, which the phone supplies. That matters: an officer
 * who back-dates a visit does not thereby extend or shorten their window, and
 * nothing typed into a browser can move it. `PATCH /api/visits/:id` answers 422
 * `correction_window_closed` when it has passed, and the five evidence columns
 * are refused by a database trigger besides.
 *
 * This exists only so the screen does not offer a button the server will
 * refuse. It is never the authority.
 */
export function correctionState(
  visit: Pick<Visit, 'officer_id' | 'received_at'>,
  myOfficerId: string | null,
  now = new Date(),
): CorrectionState {
  const receivedAt = new Date(visit.received_at);
  const closesAt = new Date(receivedAt.getTime() + VISIT_LIMITS.correctionWindowHours * 3_600_000);
  if (!myOfficerId || visit.officer_id !== myOfficerId) {
    return { canCorrect: false, reason: 'not_mine', closesAt: null };
  }
  if (now.getTime() > closesAt.getTime()) {
    return { canCorrect: false, reason: 'closed', closesAt: closesAt.toISOString() };
  }
  return { canCorrect: true, reason: 'open', closesAt: closesAt.toISOString() };
}

export interface CorrectionDraft {
  advice: string;
  observation: string;
  topics: VisitTopic[];
  duration_minutes: string;
  attendee_count: string;
  /** The id of the visit this one follows, or '' for "not a follow-up". */
  follow_up_of: string;
}

export const correctionDraftFrom = (visit: Visit): CorrectionDraft => ({
  advice: visit.advice,
  observation: visit.observation ?? '',
  topics: [...visit.topics],
  duration_minutes: visit.duration_minutes === null ? '' : String(visit.duration_minutes),
  attendee_count: visit.attendee_count === null ? '' : String(visit.attendee_count),
  // The relationship as it stands. Starting from the stored value is what
  // stops an unrelated correction from quietly clearing it.
  follow_up_of: visit.follow_up_of ?? '',
});

const sameTopics = (a: readonly VisitTopic[], b: readonly VisitTopic[]) =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

/**
 * The correction, as a DIFF.
 *
 * Only what changed is sent, and the absent/null distinction is carried
 * exactly: an emptied observation sends `null` (cleared on purpose), while an
 * untouched one sends no key at all (leave it alone). `correctVisitSchema` is
 * strict and holds no farmer, officer, position or moment, so the fields this
 * cannot reach are refused as unknown before any rule is consulted.
 */
export function buildCorrection(visit: Visit, draft: CorrectionDraft): CorrectVisit {
  const patch: Record<string, unknown> = {};
  const advice = draft.advice.trim();
  if (advice !== visit.advice) patch.advice = advice;

  const observation = draft.observation.trim();
  const wasObservation = visit.observation ?? '';
  if (observation !== wasObservation) patch.observation = observation === '' ? null : observation;

  if (!sameTopics(draft.topics, visit.topics)) patch.topics = draft.topics;

  const duration = wholeOrUndefined(draft.duration_minutes);
  if ((duration ?? null) !== visit.duration_minutes) patch.duration_minutes = duration ?? null;

  const attendees = wholeOrUndefined(draft.attendee_count);
  if ((attendees ?? null) !== visit.attendee_count) patch.attendee_count = attendees ?? null;

  /*
   * THE FOLLOW-UP, IN THE CONTRACT'S THREE STATES.
   *
   *   unchanged -> NO KEY. The server's `if ('follow_up_of' in body)` never
   *                fires, the column is not touched, and `checkFollowUp` never
   *                runs -- which is what lets a visit whose target has since
   *                been REMOVED survive an unrelated correction.
   *   cleared   -> null. The key is present and the column is set to NULL.
   *   set       -> the uuid.
   *
   * NEVER `undefined`. A key holding undefined counts toward
   * `correctVisitSchema`'s "change at least one thing" refine, and then
   * JSON.stringify drops it -- so the server would receive `{}` and refuse the
   * whole correction with a 400 that named nothing the officer did.
   */
  const followUp = draft.follow_up_of;
  const wasFollowUp = visit.follow_up_of ?? '';
  if (followUp !== wasFollowUp) patch.follow_up_of = followUp === '' ? null : followUp;

  return patch as CorrectVisit;
}

export const isEmptyCorrection = (patch: CorrectVisit): boolean => Object.keys(patch).length === 0;

/** The shared schema's verdict on a correction, in its own words. */
export function correctionProblems(patch: CorrectVisit): Problem[] {
  const parsed = correctVisitSchema.safeParse(patch);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => ({
    field: String(issue.path[0] ?? 'form'),
    message: issue.message,
  }));
}

/* ---- Which earlier visits may be followed ----------------------------- */

export interface FollowUpOption {
  id: string;
  label: string;
  /**
   * The target exists but nothing about it may be shown -- it has been removed,
   * or the chain has not arrived. The relationship is preserved; the details
   * are not invented.
   */
  opaque?: boolean;
}

/**
 * THE OPTIONS FOR A FOLLOW-UP, AND WHY THE CURRENT ONE IS ALWAYS AMONG THEM.
 *
 * The eligible list is one page of `GET /api/farmers/:id/visits` -- farmer
 * scoped, caseload checked by the server. That page is NOT the contract: the
 * server accepts any non-removed visit of the same farmer, whoever recorded
 * it. So this never narrows to the officer's own visits, and it never treats
 * "not on this page" as "not allowed".
 *
 * WHICH IS THE POINT OF THE LAST STEP. If the visit already follows something
 * that is not on the page -- older than twenty, or since removed -- the
 * relationship is STILL offered, as the selected value, so that an officer
 * correcting the advice does not silently clear a link they never looked at.
 * When the target cannot be read, the option says only that it exists.
 *
 * Two exclusions, both of which the server would obviously refuse: the visit
 * itself (`follow_up_cycle`, and a CHECK constraint besides) and any visit
 * already known to follow this one. Deeper cycles are the server's to catch;
 * this does not walk the graph pretending to be the guard.
 */
export function followUpOptions(input: {
  eligible: readonly Visit[];
  selfId: string;
  excludeIds: readonly string[];
  currentId: string | null;
  currentLink: ChainLink | null;
  label: (visit: Visit) => string;
}): FollowUpOption[] {
  const { eligible, selfId, excludeIds, currentId, currentLink, label } = input;
  const barred = new Set<string>([selfId, ...excludeIds]);
  const options: FollowUpOption[] = eligible
    .filter((visit) => !barred.has(visit.id))
    .map((visit) => ({ id: visit.id, label: label(visit) }));

  if (currentId && !options.some((option) => option.id === currentId)) {
    if (currentLink && !isRemovedLink(currentLink) && currentLink.id === currentId) {
      options.unshift({ id: currentId, label: label(currentLink) });
    } else {
      options.unshift({
        id: currentId,
        label: 'The visit this one follows',
        opaque: true,
      });
    }
  }
  return options;
}
