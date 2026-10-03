import { describe, expect, it } from 'vitest';

import {
  correctVisitSchema,
  recordVisitSchema,
  VISIT_LIMITS,
  VISIT_TOPICS,
} from '@agri-erp/shared';

import {
  buildCorrection,
  buildVisit,
  correctionDraftFrom,
  correctionProblems,
  correctionState,
  emptyVisitDraft,
  isEmptyCorrection,
  localToIso,
  TOPICS,
  toggleTopic,
  followUpOptions,
  visitProblems,
  type Fix,
  type VisitDraft,
} from './visits';
import type { Visit } from '@/lib/visits/api';

const ID = 'b2c3d4e5-6f70-4812-9a3b-4c5d6e7f8091';
const newId = () => ID;
const ME = '11111111-2222-4333-8444-555555555555';

/** A reading from a phone standing in a field outside Juba. */
const fix: Fix = { longitude: 31.5825, latitude: 4.8594, accuracy_m: 8 };

const draft = (over: Partial<VisitDraft> = {}): VisitDraft => ({
  ...emptyVisitDraft(new Date('2026-09-21T09:30:00Z')),
  advice: 'Thin the sorghum to one plant per station and weed before the next rain.',
  observation: 'Striga on the eastern quarter.',
  topics: ['weeding', 'pest'],
  ...over,
});

const visit = (over: Partial<Visit> = {}): Visit =>
  ({
    id: ID,
    farmer_id: 'f-1',
    officer_id: ME,
    payam_id: 'CE-JUB-MUN',
    county_id: 'CE-JUB',
    state_id: 'CE',
    visited_at: '2026-09-21T09:30:00.000Z',
    received_at: '2026-09-21T10:00:00.000Z',
    observation: 'Striga on the eastern quarter.',
    advice: 'Thin the sorghum to one plant per station.',
    topics: ['weeding'],
    duration_minutes: 45,
    attendee_count: 3,
    follow_up_of: null,
    created_at: '2026-09-21T10:00:00.000Z',
    updated_at: '2026-09-21T10:00:00.000Z',
    attachments: [],
    ...over,
  }) as Visit;

describe('the nine topics come from the shared list, not a second one', () => {
  it('is the canonical array itself', () => {
    expect(TOPICS).toBe(VISIT_TOPICS);
    expect(TOPICS).toHaveLength(9);
  });

  it('a topic outside the list is refused by the shared schema, not by this module', () => {
    const body = { ...buildVisit(draft(), fix, newId), topics: ['irrigation'] };
    expect(recordVisitSchema.safeParse(body).success).toBe(false);
  });

  it('at least one topic is required', () => {
    expect(visitProblems(draft({ topics: [] }), fix).some((p) => p.field === 'topics')).toBe(true);
  });

  it('each topic once: toggling adds then removes', () => {
    expect(toggleTopic(['weeding'], 'pest')).toEqual(['weeding', 'pest']);
    expect(toggleTopic(['weeding', 'pest'], 'weeding')).toEqual(['pest']);
  });
});

describe('advice is required, in the schema’s own words', () => {
  it('an empty advice is refused before the request is made', () => {
    const problems = visitProblems(draft({ advice: '   ' }), fix);
    expect(problems.some((p) => p.field === 'advice')).toBe(true);
  });

  it('the message is the shared schema’s, so the screen cannot disagree with the API', () => {
    const problems = visitProblems(draft({ advice: '' }), fix);
    expect(problems.find((p) => p.field === 'advice')?.message).toBe(
      'Write the advice you gave. A visit with no advice is not a visit.',
    );
  });

  it('a complete draft has nothing wrong with it', () => {
    expect(visitProblems(draft(), fix)).toEqual([]);
  });
});

describe('the position is the device’s reading, and the route requires one', () => {
  it('without a reading there is no body to send, and the screen says why', () => {
    const problems = visitProblems(draft(), null);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.field).toBe('position');
  });

  it('is sent as a GeoJSON Point, longitude first', () => {
    const body = buildVisit(draft(), fix, newId);
    expect(body.position).toEqual({ type: 'Point', coordinates: [31.5825, 4.8594] });
    expect(body.gps_accuracy_m).toBe(8);
  });
});

describe('date and time follow the contract', () => {
  it('a local value becomes an absolute moment the schema accepts', () => {
    const iso = localToIso('2026-09-21T09:30');
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(recordVisitSchema.safeParse(buildVisit(draft(), fix, newId)).success).toBe(true);
  });

  it('an unparseable value becomes empty, and the schema refuses it by name', () => {
    expect(localToIso('not a date')).toBe('');
    const problems = visitProblems(draft({ visited_at: 'not a date' }), fix);
    expect(problems.some((p) => p.field === 'visited_at')).toBe(true);
  });

  it('the officer’s moment is sent; the server’s is the server’s and is never sent', () => {
    const body = buildVisit(draft(), fix, newId) as Record<string, unknown>;
    expect('visited_at' in body).toBe(true);
    expect('received_at' in body).toBe(false);
  });
});

describe('absent is not null', () => {
  it('an unanswered optional is left OUT of the body, not sent as null', () => {
    const body = buildVisit(
      draft({ observation: '', duration_minutes: '', attendee_count: '' }),
      fix,
      newId,
    ) as Record<string, unknown>;
    expect('observation' in body).toBe(false);
    expect('duration_minutes' in body).toBe(false);
    expect('attendee_count' in body).toBe(false);
  });

  it('an answered one is sent, as a number', () => {
    const body = buildVisit(draft({ duration_minutes: '45', attendee_count: '3' }), fix, newId);
    expect(body.duration_minutes).toBe(45);
    expect(body.attendee_count).toBe(3);
  });

  it('never sends what the server decides for itself', () => {
    const body = buildVisit(draft(), fix, newId) as Record<string, unknown>;
    for (const key of ['farmer_id', 'officer_id', 'payam_id', 'county_id', 'state_id']) {
      expect(key in body, `${key} was sent`).toBe(false);
    }
  });

  it('carries a client id, which is the idempotency key (C-9.2)', () => {
    expect(buildVisit(draft(), fix, newId).id).toBe(ID);
  });
});

describe('the correction window is the server’s, measured from ITS moment', () => {
  const received = '2026-09-21T10:00:00.000Z';

  it('is open within twenty-four hours of received_at', () => {
    const state = correctionState(visit({ received_at: received }), ME, new Date(received));
    expect(state.canCorrect).toBe(true);
    expect(state.reason).toBe('open');
  });

  it('is closed after them', () => {
    const later = new Date('2026-09-22T10:00:01.000Z');
    expect(correctionState(visit({ received_at: received }), ME, later).reason).toBe('closed');
  });

  it('BACK-DATING visited_at CANNOT WIDEN IT — the window never reads that field', () => {
    // The evidence columns are immutable in the database besides; this is the
    // screen refusing to offer a button the server would refuse.
    const backdated = visit({ received_at: received, visited_at: '2020-01-01T00:00:00.000Z' });
    const later = new Date('2026-09-22T10:00:01.000Z');
    expect(correctionState(backdated, ME, later).canCorrect).toBe(false);
  });

  it('another officer’s visit is never correctable here, whatever the clock says', () => {
    const theirs = visit({ officer_id: 'someone-else', received_at: received });
    expect(correctionState(theirs, ME, new Date(received)).reason).toBe('not_mine');
  });

  it('uses the shared limit rather than a hardcoded twenty-four', () => {
    const state = correctionState(visit({ received_at: received }), ME, new Date(received));
    const closes = new Date(state.closesAt!).getTime() - new Date(received).getTime();
    expect(closes).toBe(VISIT_LIMITS.correctionWindowHours * 3_600_000);
  });
});

describe('a correction is a diff, and keeps absent apart from null', () => {
  it('sends only what changed', () => {
    const v = visit();
    const patch = buildCorrection(v, { ...correctionDraftFrom(v), advice: 'Changed advice.' });
    expect(patch).toEqual({ advice: 'Changed advice.' });
  });

  it('an untouched visit produces an empty patch, which the screen refuses to send', () => {
    const v = visit();
    const patch = buildCorrection(v, correctionDraftFrom(v));
    expect(isEmptyCorrection(patch)).toBe(true);
    expect(correctionProblems(patch).length).toBeGreaterThan(0);
  });

  it('CLEARING an observation sends null; leaving it alone sends no key at all', () => {
    const v = visit({ observation: 'Striga on the eastern quarter.' });
    const cleared = buildCorrection(v, { ...correctionDraftFrom(v), observation: '' });
    expect(cleared).toEqual({ observation: null });

    const untouched = buildCorrection(v, correctionDraftFrom(v)) as Record<string, unknown>;
    expect('observation' in untouched).toBe(false);
  });

  it('clearing a duration sends null, and setting one sends the number', () => {
    const v = visit({ duration_minutes: 45 });
    expect(buildCorrection(v, { ...correctionDraftFrom(v), duration_minutes: '' })).toEqual({
      duration_minutes: null,
    });
    expect(buildCorrection(v, { ...correctionDraftFrom(v), duration_minutes: '60' })).toEqual({
      duration_minutes: 60,
    });
  });

  it('cannot reach the farmer, the officer, the position or either moment', () => {
    const v = visit();
    const patch = buildCorrection(v, {
      ...correctionDraftFrom(v),
      advice: 'Changed advice.',
    }) as Record<string, unknown>;
    for (const key of ['farmer_id', 'officer_id', 'position', 'visited_at', 'received_at']) {
      expect(key in patch, `${key} is reachable`).toBe(false);
    }
  });

  it('topics are compared as a set, so reordering is not a change', () => {
    const v = visit({ topics: ['weeding', 'pest'] });
    const patch = buildCorrection(v, { ...correctionDraftFrom(v), topics: ['pest', 'weeding'] });
    expect(isEmptyCorrection(patch)).toBe(true);
  });
});

/**
 * FOLLOW-UP (C-8.3).
 *
 * THE SERVER'S RULES ARE NOT RE-TESTED HERE. `tests/visits.test.ts` already
 * proves against real staging that a follow-up must name an earlier visit of
 * the SAME farmer, that another farmer's visit, a removed one, itself and a
 * cycle are all refused, and that the database refuses the cycle on its own.
 * What is unproven until now is that this model carries the value correctly
 * and keeps absent apart from null.
 */
describe('a follow-up is an optional link to an earlier visit', () => {
  const EARLIER = 'a1b2c3d4-e5f6-4708-9a1b-2c3d4e5f6071';

  it('a visit that follows nothing sends NO KEY, not a null', () => {
    const body = buildVisit(draft({ follow_up_of: '' }), fix, newId) as Record<string, unknown>;
    expect('follow_up_of' in body).toBe(false);
  });

  it('a visit that follows one sends its id', () => {
    const body = buildVisit(draft({ follow_up_of: EARLIER }), fix, newId);
    expect(body.follow_up_of).toBe(EARLIER);
  });

  it('an ordinary visit with no follow-up is still accepted by the shared schema', () => {
    expect(recordVisitSchema.safeParse(buildVisit(draft(), fix, newId)).success).toBe(true);
  });

  it('a follow-up visit is accepted by the shared schema', () => {
    const body = buildVisit(draft({ follow_up_of: EARLIER }), fix, newId);
    expect(recordVisitSchema.safeParse(body).success).toBe(true);
  });

  it('an id that is not a UUID is refused by the shared schema, not by this module', () => {
    const body = buildVisit(draft({ follow_up_of: 'the-one-last-tuesday' }), fix, newId);
    expect(recordVisitSchema.safeParse(body).success).toBe(false);
    expect(visitProblems(draft({ follow_up_of: 'the-one-last-tuesday' }), fix)).toEqual([
      { field: 'follow_up_of', message: 'The earlier visit is not in the expected form.' },
    ]);
  });

  it('the empty draft follows nothing', () => {
    expect(emptyVisitDraft().follow_up_of).toBe('');
  });

  it('a visit never names itself: the id is minted at submit, not chosen', () => {
    // `follow_up_cycle` is the server's refusal; here the point is simply that
    // nothing in the draft can reach the new visit's own id.
    const body = buildVisit(draft({ follow_up_of: EARLIER }), fix, newId);
    expect(body.id).toBe(ID);
    expect(body.follow_up_of).not.toBe(body.id);
  });
});

/**
 * CORRECTING A FOLLOW-UP, INSIDE THE TWENTY-FOUR HOURS (C-8.10 with C-8.3).
 *
 * The server's rules are not re-tested here: `tests/visits.test.ts` proves
 * against real staging that a follow-up must name a non-removed visit of the
 * same farmer, that a cycle is refused, and that the window is measured from
 * the server's own moment. These prove the CORRECTION carries the officer's
 * intention across the wire without conflating the contract's three states.
 */
describe('a follow-up can be added, changed or cleared by a correction', () => {
  const EARLIER = 'a1b2c3d4-e5f6-4708-9a1b-2c3d4e5f6071';
  const ANOTHER = 'c3d4e5f6-a7b8-4901-8c2d-3e4f5a6b7c82';

  it('UNCHANGED sends no key, so an unrelated correction cannot clear it', () => {
    const v = visit({ follow_up_of: EARLIER });
    const patch = buildCorrection(v, {
      ...correctionDraftFrom(v),
      advice: 'Different advice entirely.',
    }) as Record<string, unknown>;
    expect('follow_up_of' in patch).toBe(false);
    expect(patch.advice).toBe('Different advice entirely.');
  });

  it('ADDING one sends the uuid', () => {
    const v = visit({ follow_up_of: null });
    expect(buildCorrection(v, { ...correctionDraftFrom(v), follow_up_of: EARLIER })).toEqual({
      follow_up_of: EARLIER,
    });
  });

  it('CHANGING it sends the new uuid', () => {
    const v = visit({ follow_up_of: EARLIER });
    expect(buildCorrection(v, { ...correctionDraftFrom(v), follow_up_of: ANOTHER })).toEqual({
      follow_up_of: ANOTHER,
    });
  });

  it('CLEARING it sends null — the contract’s way of saying "no longer follows anything"', () => {
    const v = visit({ follow_up_of: EARLIER });
    expect(buildCorrection(v, { ...correctionDraftFrom(v), follow_up_of: '' })).toEqual({
      follow_up_of: null,
    });
  });

  it('never sends undefined, which would pass the refine and then vanish in JSON', () => {
    // A key holding undefined counts toward "change at least one thing" and is
    // then dropped by JSON.stringify, so the server would receive {} and refuse
    // the whole correction with a 400 naming nothing the officer did.
    const v = visit({ follow_up_of: EARLIER });
    for (const draftValue of ['', EARLIER, ANOTHER]) {
      const patch = buildCorrection(v, {
        ...correctionDraftFrom(v),
        follow_up_of: draftValue,
      }) as Record<string, unknown>;
      if ('follow_up_of' in patch) expect(patch.follow_up_of).not.toBeUndefined();
      expect(JSON.parse(JSON.stringify(patch))).toEqual(patch);
    }
  });

  it('the three states stay distinct through the shared schema and JSON', () => {
    const v = visit({ follow_up_of: EARLIER });
    const unchanged = buildCorrection(v, { ...correctionDraftFrom(v), advice: 'x' });
    const cleared = buildCorrection(v, { ...correctionDraftFrom(v), follow_up_of: '' });
    const set = buildCorrection(v, { ...correctionDraftFrom(v), follow_up_of: ANOTHER });

    expect(JSON.stringify(correctVisitSchema.parse(unchanged))).toBe('{"advice":"x"}');
    expect(JSON.stringify(correctVisitSchema.parse(cleared))).toBe('{"follow_up_of":null}');
    expect(JSON.stringify(correctVisitSchema.parse(set))).toBe(`{"follow_up_of":"${ANOTHER}"}`);
  });

  it('clearing a visit that already follows nothing is not a change', () => {
    const v = visit({ follow_up_of: null });
    expect(isEmptyCorrection(buildCorrection(v, correctionDraftFrom(v)))).toBe(true);
  });

  it('the draft starts from the stored relationship', () => {
    expect(correctionDraftFrom(visit({ follow_up_of: EARLIER })).follow_up_of).toBe(EARLIER);
    expect(correctionDraftFrom(visit({ follow_up_of: null })).follow_up_of).toBe('');
  });
});

describe('which earlier visits are offered', () => {
  const EARLIER = 'a1b2c3d4-e5f6-4708-9a1b-2c3d4e5f6071';
  const label = (v: Visit) => `visit ${v.id}`;
  const page = (...ids: string[]) => ids.map((id) => visit({ id }));

  it('offers the farmer’s visits, whoever recorded them', () => {
    // The contract scopes a follow-up by FARMER, not by officer: a reassigned
    // farmer's earlier visits belong to someone else and are valid targets.
    const eligible = [visit({ id: 'v1', officer_id: 'someone-else' }), visit({ id: 'v2' })];
    const options = followUpOptions({
      eligible,
      selfId: 'me',
      excludeIds: [],
      currentId: null,
      currentLink: null,
      label,
    });
    expect(options.map((o) => o.id)).toEqual(['v1', 'v2']);
  });

  it('never offers the visit itself', () => {
    const options = followUpOptions({
      eligible: page('v1', 'self'),
      selfId: 'self',
      excludeIds: [],
      currentId: null,
      currentLink: null,
      label,
    });
    expect(options.map((o) => o.id)).toEqual(['v1']);
  });

  it('never offers a visit already known to follow this one', () => {
    const options = followUpOptions({
      eligible: page('v1', 'child'),
      selfId: 'self',
      excludeIds: ['child'],
      currentId: null,
      currentLink: null,
      label,
    });
    expect(options.map((o) => o.id)).toEqual(['v1']);
  });

  it('KEEPS A CURRENT TARGET THAT IS OUTSIDE THE FETCHED PAGE, with its details', () => {
    const options = followUpOptions({
      eligible: page('v1'),
      selfId: 'self',
      excludeIds: [],
      currentId: EARLIER,
      currentLink: visit({ id: EARLIER }),
      label,
    });
    expect(options[0]).toEqual({ id: EARLIER, label: `visit ${EARLIER}` });
  });

  it('keeps a REMOVED target as a relationship without exposing anything about it', () => {
    const options = followUpOptions({
      eligible: page('v1'),
      selfId: 'self',
      excludeIds: [],
      currentId: EARLIER,
      currentLink: { id: EARLIER, removed: true },
      label,
    });
    expect(options[0]).toEqual({ id: EARLIER, label: 'The visit this one follows', opaque: true });
    expect(options[0]!.label).not.toContain('visit ' + EARLIER);
  });

  it('keeps it even when the chain has not arrived, rather than dropping the link', () => {
    const options = followUpOptions({
      eligible: page('v1'),
      selfId: 'self',
      excludeIds: [],
      currentId: EARLIER,
      currentLink: null,
      label,
    });
    expect(options[0]?.id).toBe(EARLIER);
    expect(options[0]?.opaque).toBe(true);
  });

  it('does not duplicate the current target when it IS on the page', () => {
    const options = followUpOptions({
      eligible: page(EARLIER, 'v2'),
      selfId: 'self',
      excludeIds: [],
      currentId: EARLIER,
      currentLink: visit({ id: EARLIER }),
      label,
    });
    expect(options.filter((o) => o.id === EARLIER)).toHaveLength(1);
  });
});
