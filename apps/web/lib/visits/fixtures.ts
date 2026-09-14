// Sample extension visits for walking the visits screen before a sign-in
// endpoint exists (every live call is 401 until an officer is signed in). Not
// real data. The screens read these when NEXT_PUBLIC_USE_LIVE_VISITS is unset.
//
// The ids and payams line up with the farmer and officer fixtures elsewhere in
// apps/web so a reviewer moving between the register and this log sees the same
// people and places.

import type { VisitTopic } from '@agri-erp/shared';

import type { Visit, VisitAttachment } from './api';

/** The nine visit topics, in the words an officer reads on screen. */
export const VISIT_TOPIC_LABELS: Record<VisitTopic, string> = {
  land_preparation: 'Land preparation',
  planting: 'Planting',
  weeding: 'Weeding',
  pest: 'Pest control',
  disease: 'Disease',
  harvest: 'Harvest',
  storage: 'Storage',
  market: 'Market',
  other: 'Other',
};

/** Payam names, matching the register. Unknown ids fall back to the id. */
export const PAYAM_NAMES: Record<string, string> = {
  'CE-JUB-JUB': 'Juba',
  'CE-JUB-KAT': 'Kator',
  'CE-JUB-MUN': 'Munuki',
  'CE-JUB-REJ': 'Rejaf',
  'CE-JUB-NBA': 'Northern Bari',
  'CE-JUB-GAN': 'Gondokoro',
};

const oid = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const fid = (n: number) => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const vid = (n: number) => `f0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const aid = (n: number) => `fa000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Officer names by id. Unknown ids fall back to the id. */
export const OFFICER_NAMES: Record<string, string> = {
  you: 'You',
  [oid(1)]: 'Achol Deng',
  [oid(2)]: 'Emmanuel Ladu',
  [oid(3)]: 'Grace Poni',
  [oid(4)]: 'Peter Lomeling',
  [oid(5)]: 'Sarah Nyakuma',
};

/** Farmer names by id. Unknown ids fall back to the id. */
export const FARMER_NAMES: Record<string, string> = {
  [fid(1)]: 'Regina Aya',
  [fid(2)]: 'Joseph Lokonga',
  [fid(3)]: 'Betty Nakato',
  [fid(4)]: 'Simon Duku',
  [fid(5)]: 'Mary Keji',
  [fid(6)]: 'Isaac Wani',
};

/** A farmer an officer may record a visit for, with the place a new visit inherits. */
export interface FarmerOption {
  id: string;
  name: string;
  payam_id: string;
  county_id: string;
  state_id: string;
}

/** The caseload the record-a-visit form offers before a live farmer list exists. */
export const FARMER_OPTIONS: readonly FarmerOption[] = [
  { id: fid(1), name: 'Regina Aya', payam_id: 'CE-JUB-MUN', county_id: 'CE-JUB', state_id: 'CE' },
  {
    id: fid(2),
    name: 'Joseph Lokonga',
    payam_id: 'CE-JUB-MUN',
    county_id: 'CE-JUB',
    state_id: 'CE',
  },
  { id: fid(3), name: 'Betty Nakato', payam_id: 'CE-JUB-KAT', county_id: 'CE-JUB', state_id: 'CE' },
  { id: fid(4), name: 'Simon Duku', payam_id: 'CE-JUB-JUB', county_id: 'CE-JUB', state_id: 'CE' },
  { id: fid(5), name: 'Mary Keji', payam_id: 'CE-JUB-KAT', county_id: 'CE-JUB', state_id: 'CE' },
  { id: fid(6), name: 'Isaac Wani', payam_id: 'CE-JUB-REJ', county_id: 'CE-JUB', state_id: 'CE' },
];

export function payamName(id: string): string {
  return PAYAM_NAMES[id] ?? id;
}
export function officerName(id: string): string {
  return OFFICER_NAMES[id] ?? id;
}
export function farmerName(id: string): string {
  return FARMER_NAMES[id] ?? id;
}

function attachment(
  n: number,
  visit: string,
  over: Partial<VisitAttachment> & Pick<VisitAttachment, 'kind' | 'status'>,
): VisitAttachment {
  const base: VisitAttachment = {
    id: aid(n),
    visit_id: visit,
    kind: over.kind,
    status: over.status,
    message: '',
    content_type: over.kind === 'photo' ? 'image/jpeg' : 'audio/mp4',
    byte_size: over.kind === 'photo' ? 2_400_000 : 1_100_000,
    captured_at: '2026-09-05T08:20:00Z',
    declared_at: '2026-09-05T08:22:00Z',
    arrived_at: over.status === 'arrived' ? '2026-09-05T08:25:00Z' : null,
    failed_at: over.status === 'failed' ? '2026-09-05T09:40:00Z' : null,
    failure_code: over.status === 'failed' ? 'device_gave_up' : null,
  };
  // The sentence beside each attachment, as the server writes it (C-8.7).
  const message =
    over.status === 'arrived'
      ? 'Received.'
      : over.status === 'failed'
        ? 'This did not send. Open the visit and send it again.'
        : 'This has not reached the server yet. Keep the phone on with signal and it will send by itself.';
  return { ...base, message, ...over };
}

const juba: Pick<Visit, 'county_id' | 'state_id'> = {
  county_id: 'CE-JUB',
  state_id: 'CE',
};

function visit(
  n: number,
  over: Pick<
    Visit,
    'farmer_id' | 'officer_id' | 'payam_id' | 'visited_at' | 'received_at' | 'advice' | 'topics'
  > &
    Partial<Visit>,
): Visit {
  return {
    id: vid(n),
    ...juba,
    observation: null,
    duration_minutes: null,
    attendee_count: null,
    follow_up_of: null,
    created_at: over.received_at,
    updated_at: over.received_at,
    attachments: [],
    ...over,
  };
}

/**
 * A caseload's recent visits, newest received first, so the log reads the way
 * the live list pages it (C-8.5). A spread of topics, some with observations,
 * some with attachments in each of the three states, and one follow-up.
 */
export const VISITS_FIXTURE: readonly Visit[] = [
  visit(1, {
    farmer_id: fid(1),
    officer_id: oid(3),
    payam_id: 'CE-JUB-MUN',
    visited_at: '2026-09-05T08:15:00Z',
    received_at: '2026-09-05T08:26:00Z',
    advice:
      'Thin the groundnut stand to one plant per hole and weed before flowering. Second weeding in two weeks.',
    observation:
      'Even germination on the eastern half; the low corner is waterlogged after the rain.',
    topics: ['weeding', 'planting'],
    duration_minutes: 45,
    attendee_count: 3,
    follow_up_of: vid(5),
    attachments: [
      attachment(1, vid(1), { kind: 'photo', status: 'arrived' }),
      attachment(2, vid(1), { kind: 'photo', status: 'waiting' }),
    ],
  }),
  visit(2, {
    farmer_id: fid(2),
    officer_id: oid(3),
    payam_id: 'CE-JUB-MUN',
    visited_at: '2026-09-04T10:40:00Z',
    received_at: '2026-09-04T14:05:00Z',
    advice:
      'Fall armyworm on about one in ten maize plants. Scout weekly and hand-pick egg masses before spraying.',
    observation: 'Windows and small holes on the whorl leaves of the youngest maize.',
    topics: ['pest', 'disease'],
    duration_minutes: 60,
    attendee_count: 1,
    attachments: [attachment(3, vid(2), { kind: 'audio', status: 'arrived' })],
  }),
  visit(3, {
    farmer_id: fid(3),
    officer_id: oid(2),
    payam_id: 'CE-JUB-KAT',
    visited_at: '2026-09-03T09:00:00Z',
    received_at: '2026-09-03T09:12:00Z',
    advice:
      'Dry the sesame to a hard seed before bagging, and raise the bags off the store floor on pallets.',
    topics: ['harvest', 'storage'],
    duration_minutes: 30,
    attachments: [attachment(4, vid(3), { kind: 'photo', status: 'failed' })],
  }),
  visit(4, {
    farmer_id: fid(4),
    officer_id: oid(1),
    payam_id: 'CE-JUB-JUB',
    visited_at: '2026-09-02T15:20:00Z',
    received_at: '2026-09-02T16:00:00Z',
    advice:
      'Prices at Konyo Konyo favour selling sorghum in the next two weeks. Group the harvest with neighbours for a better rate.',
    topics: ['market'],
    attendee_count: 12,
    duration_minutes: 90,
  }),
  visit(5, {
    farmer_id: fid(1),
    officer_id: oid(3),
    payam_id: 'CE-JUB-MUN',
    visited_at: '2026-08-22T08:30:00Z',
    received_at: '2026-08-22T08:41:00Z',
    advice:
      'Ridge and clear the plot before the next rains; the waterlogged corner needs a drainage furrow.',
    topics: ['land_preparation'],
    duration_minutes: 40,
  }),
  visit(6, {
    farmer_id: fid(5),
    officer_id: oid(2),
    payam_id: 'CE-JUB-KAT',
    visited_at: '2026-08-20T11:10:00Z',
    received_at: '2026-08-20T11:25:00Z',
    advice:
      'Store cassava cuttings upright in a shaded, moist pit until planting to keep them viable.',
    observation: 'Cuttings from a healthy field, no streak symptoms seen.',
    topics: ['storage', 'other'],
    duration_minutes: 25,
  }),
];
