import type { Crop } from '@agri-erp/shared';

import { PAYAMS, payamName } from './p1';

/**
 * FIXTURE DATA for the Farmers module preview. EVERY ROW HERE IS INVENTED.
 *
 * Names, phone numbers and national ids are made up so a screen has something
 * to show; none of it is CORWADO data and the phone numbers are not real
 * numbers (CLAUDE.md, "Personal data"). Shapes mirror docs/data-model.md
 * sections 1–4 so that swapping this file for API responses is a one-line
 * change per screen.
 *
 * FARMER NUMBER FORMAT IS A PLACEHOLDER. The registration-number scheme is
 * deliverable C-5 and is not written yet; `CE-JUB-000123` is a stand-in shape,
 * not the agreed format. Marked here and on the /design page.
 */

export type Sex = 'f' | 'm';
export type VerificationStatus = 'pending' | 'verified' | 'rejected';
export type RegistrationSource = 'officer' | 'self';
export type AccuracyFlag = 'good' | 'poor' | 'unusable';
export type FarmSyncStatus = 'waiting' | 'sending' | 'synced' | 'failed';
export type ConsentVersion = 'v1.0-en' | 'v1.0-ar-juba';
export type ConsentLanguage = 'en' | 'ar-juba';
export type MemberRole = 'member' | 'chair' | 'treasurer' | 'secretary';
export type ReviewDecision = 'verified' | 'merged' | 'rejected';
export type UserRole = 'admin' | 'supervisor' | 'read_only';

export const SEASON = '2026-main';

/** Placeholder farmer-number shape. Replace when C-5 lands. */
export const FARMER_NUMBER_FORMAT = 'CE-JUB-000123 (placeholder — C-5 unwritten)';

/** A GeoJSON-style polygon ring: [lon, lat] pairs, first point repeated last. */
export type Ring = ReadonlyArray<readonly [number, number]>;

export interface Officer {
  id: string;
  name: string;
  phone: string;
  payam_id: string;
  last_sync_at: string | null;
  status: 'active' | 'inactive';
}

export interface User {
  id: string;
  name: string;
  role: UserRole;
  scope_state_id: string | null;
}

export interface Cooperative {
  id: string;
  name: string;
  payam_id: string;
  registered_year: number;
  primary_crop: Crop;
}

export interface CooperativeMember {
  cooperative_id: string;
  farmer_id: string;
  role: MemberRole;
  joined_at: string;
}

export interface Farmer {
  id: string;
  farmer_number: string;
  given_name: string;
  family_name: string;
  sex: Sex;
  year_of_birth: number;
  phone: string;
  national_id: string | null;
  payam_id: string;
  state_id: string;
  registered_by: string | null;
  /** Who works this farmer today (C-8R): the reassignable caseload pointer.
   *  `registered_by` is history and never changes. Optional here because the
   *  fixtures predate B8.5; when absent, the caseload officer is the one who
   *  registered them. */
  caseload_officer_id?: string | null;
  registration_source: RegistrationSource;
  verification_status: VerificationStatus;
  merged_into: string | null;
  consent_id: string;
  created_at: string;
}

export interface Farm {
  id: string;
  farmer_id: string;
  boundary: { type: 'Polygon'; coordinates: [Ring] } | null;
  centroid: { lon: number; lat: number };
  area_ha: number;
  point_count: number;
  gps_accuracy_m: number;
  accuracy_flag: AccuracyFlag;
  mapped_by: string;
  mapped_at: string;
  season: string;
}

export interface CropDeclaration {
  id: string;
  farm_id: string;
  crop: Crop;
  season: string;
  declared_at: string;
}

export interface Consent {
  id: string;
  farmer_id: string;
  text_version: ConsentVersion;
  language: ConsentLanguage;
  granted: boolean;
  granted_at: string;
  withdrawn_at: string | null;
}

export interface VerificationEvent {
  id: string;
  farmer_id: string;
  reviewer_id: string;
  decision: ReviewDecision;
  merge_target_id: string | null;
  reason: string | null;
  days_waiting: number;
  decided_at: string;
}

export interface SyncRecord {
  id: string;
  entity_type: 'farmer' | 'farm';
  entity_id: string;
  device_id: string;
  officer_id: string;
  sync_status: FarmSyncStatus;
  reason_code: string | null;
  attempt_count: number;
  acknowledged_at: string | null;
}

export interface AuditEvent {
  id: string;
  entity_type: string;
  entity_id: string;
  actor_id: string;
  action: string;
  device_id: string | null;
  occurred_at: string;
}

/* ---- Locations ------------------------------------------------------- */

/**
 * A handful of out-of-state rows so state scoping can be seen to work: a
 * supervisor, officer or read-only preview on Central Equatoria must not see
 * these Western Equatoria farmers; an admin sees everyone.
 */
const EXTRA_PAYAMS: Record<string, { name: string; state: string }> = {
  'WE-YAM-YAM': { name: 'Yambio', state: 'WE' },
  'WE-MRD-MRD': { name: 'Maridi', state: 'WE' },
};

export const STATE_NAMES: Record<string, string> = {
  CE: 'Central Equatoria',
  WE: 'Western Equatoria',
};

export function farmerPayamName(id: string): string {
  if (EXTRA_PAYAMS[id]) return EXTRA_PAYAMS[id].name;
  return payamName(id);
}

function payamState(id: string): string {
  if (EXTRA_PAYAMS[id]) return EXTRA_PAYAMS[id].state;
  return 'CE';
}

const CE_PAYAM_IDS = PAYAMS.map((p) => p.id);

/* ---- Deterministic ids ---------------------------------------------- */

const oid = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const uid = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cid = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const fid = (n: number) => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const farmid = (n: number) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/* ---- People ---------------------------------------------------------- */

export const OFFICERS: readonly Officer[] = [
  ['Achol Deng', 'CE-JUB-JUB', '2026-09-01T17:20:00Z', 'active'],
  ['Emmanuel Ladu', 'CE-JUB-KAT', '2026-09-02T06:05:00Z', 'active'],
  ['Grace Poni', 'CE-JUB-MUN', '2026-08-31T14:40:00Z', 'active'],
  ['Peter Lomeling', 'CE-JUB-REJ', '2026-08-28T11:15:00Z', 'active'],
  ['Sarah Nyakuma', 'CE-JUB-NBA', '2026-09-02T05:30:00Z', 'active'],
  ['John Wani', 'CE-JUB-GAN', null, 'inactive'],
].map(([name, payam, sync, status], i) => ({
  id: oid(i + 1),
  name: name as string,
  phone: `+2119220000${String(i + 10)}`,
  payam_id: payam as string,
  last_sync_at: sync as string | null,
  status: status as 'active' | 'inactive',
}));

export const USERS: readonly User[] = [
  { id: uid(1), name: 'Programme Admin', role: 'admin', scope_state_id: null },
  { id: uid(2), name: 'Rebecca Kiden', role: 'supervisor', scope_state_id: 'CE' },
  { id: uid(3), name: 'Donor Read-only', role: 'read_only', scope_state_id: 'CE' },
];

const SUPERVISOR_ID = uid(2);

/**
 * The officer whose caseload the "Field officer" preview role stands in for.
 * Grace Poni (Munuki) is chosen deliberately: her caseload spans verified,
 * pending, an escalated wait and a name+payam duplicate, so the officer view
 * has something honest to show. Swapped for the signed-in officer under B3.
 */
export const PREVIEW_OFFICER_ID = OFFICERS[2]!.id;

export const COOPERATIVES: readonly Cooperative[] = [
  ['Rejaf Sorghum Growers', 'CE-JUB-REJ', 2021, 'sorghum'],
  ['Munuki Women Groundnut Coop', 'CE-JUB-MUN', 2019, 'groundnut'],
  ['Kator Sesame Union', 'CE-JUB-KAT', 2022, 'sesame'],
  ['Northern Bari Maize Group', 'CE-JUB-NBA', 2023, 'maize'],
].map(([name, payam, year, crop], i) => ({
  id: cid(i + 1),
  name: name as string,
  payam_id: payam as string,
  registered_year: year as number,
  primary_crop: crop as Crop,
}));

/* ---- Geometry -------------------------------------------------------- */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const METRES_PER_DEG_LAT = 110540;
function metresPerDegLon(lat: number): number {
  return 111320 * Math.cos((lat * Math.PI) / 180);
}

/** Shoelace area of a lon/lat ring, in hectares. */
function ringAreaHa(ring: Ring, lat: number): number {
  const mx = metresPerDegLon(lat);
  const my = METRES_PER_DEG_LAT;
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[i + 1]!;
    sum += x1 * mx * (y2 * my) - x2 * mx * (y1 * my);
  }
  return Math.abs(sum / 2) / 10000;
}

/** A small, slightly irregular field polygon around a centre. */
function makeRing(seed: number, lon: number, lat: number, targetHa: number, points: number): Ring {
  const rand = mulberry32(seed);
  const radiusM = Math.sqrt((targetHa * 10000) / Math.PI) * 1.1;
  const mx = metresPerDegLon(lat);
  const my = METRES_PER_DEG_LAT;
  const ring: Array<readonly [number, number]> = [];
  for (let k = 0; k < points; k++) {
    const angle = (k / points) * 2 * Math.PI + (rand() - 0.5) * 0.5;
    const r = radiusM * (0.78 + rand() * 0.44);
    const dx = Math.cos(angle) * r;
    const dy = Math.sin(angle) * r;
    ring.push([Number((lon + dx / mx).toFixed(6)), Number((lat + dy / my).toFixed(6))] as const);
  }
  ring.push(ring[0]!);
  return ring;
}

/* ---- Builders -------------------------------------------------------- */

const REFERENCE = Date.UTC(2026, 8, 2); // 2026-09-02, the preview "today"
function daysAgoIso(days: number): string {
  return new Date(REFERENCE - days * 86_400_000).toISOString();
}

interface FarmSpec {
  targetHa: number;
  points?: number;
  accuracy: AccuracyFlag;
  gps: number;
  noBoundary?: boolean;
  crops: Crop[];
  centre: [number, number]; // [lon, lat]
}

interface Seed {
  g: string;
  f: string;
  sex: Sex;
  yob: number;
  phone: string; // 9 national digits
  payam: string;
  src: RegistrationSource;
  status: VerificationStatus;
  officer: number | null; // index into OFFICERS, null = not yet picked up
  nid: string | null;
  lang: ConsentLanguage;
  createdDaysAgo: number;
  sync: FarmSyncStatus;
  reason?: string;
  reject?: string;
  mergedIntoIdx?: number; // index (1-based) into SEEDS of the survivor
  resubmitted?: boolean;
  farms: FarmSpec[];
}

// Coordinates scatter around Juba (~31.60E, 4.85N).
function jubaCentre(i: number): [number, number] {
  const r = mulberry32(9001 + i * 131);
  return [Number((31.54 + r() * 0.18).toFixed(5)), Number((4.78 + r() * 0.16).toFixed(5))];
}

const C = jubaCentre;

const SEEDS: Seed[] = [
  // — verified, well-mapped, cooperative members —
  {
    g: 'Mary',
    f: 'Aluel',
    sex: 'f',
    yob: 1988,
    phone: '921000101',
    payam: 'CE-JUB-REJ',
    src: 'officer',
    status: 'verified',
    officer: 3,
    nid: '99A2211455',
    lang: 'en',
    createdDaysAgo: 41,
    sync: 'synced',
    farms: [
      { targetHa: 1.8, accuracy: 'good', gps: 4, crops: ['sorghum', 'cowpea'], centre: C(1) },
      { targetHa: 0.6, accuracy: 'good', gps: 6, crops: ['groundnut'], centre: C(2) },
    ],
  },
  {
    g: 'John',
    f: 'Ladu',
    sex: 'm',
    yob: 1979,
    phone: '921000102',
    payam: 'CE-JUB-REJ',
    src: 'officer',
    status: 'verified',
    officer: 3,
    nid: '99B7781200',
    lang: 'en',
    createdDaysAgo: 38,
    sync: 'synced',
    farms: [{ targetHa: 2.4, accuracy: 'good', gps: 5, crops: ['sorghum'], centre: C(3) }],
  },
  {
    g: 'محمد',
    f: 'إدريس',
    sex: 'm',
    yob: 1972,
    phone: '921000103',
    payam: 'CE-JUB-KAT',
    src: 'officer',
    status: 'verified',
    officer: 1,
    nid: '99C5540098',
    lang: 'ar-juba',
    createdDaysAgo: 52,
    sync: 'synced',
    farms: [{ targetHa: 1.1, accuracy: 'good', gps: 7, crops: ['sesame', 'maize'], centre: C(4) }],
  },
  {
    g: 'Grace',
    f: 'Nyandeng',
    sex: 'f',
    yob: 1995,
    phone: '921000104',
    payam: 'CE-JUB-MUN',
    src: 'officer',
    status: 'verified',
    officer: 2,
    nid: null,
    lang: 'en',
    createdDaysAgo: 33,
    sync: 'synced',
    farms: [{ targetHa: 0.9, accuracy: 'good', gps: 5, crops: ['groundnut'], centre: C(5) }],
  },
  {
    g: 'Peter',
    f: 'Lomoro',
    sex: 'm',
    yob: 1984,
    phone: '921000105',
    payam: 'CE-JUB-NBA',
    src: 'officer',
    status: 'verified',
    officer: 4,
    nid: '99D1122334',
    lang: 'en',
    createdDaysAgo: 60,
    sync: 'synced',
    farms: [
      {
        targetHa: 3.0,
        points: 5,
        accuracy: 'good',
        gps: 4,
        crops: ['maize', 'sorghum'],
        centre: C(6),
      },
    ],
  },
  {
    g: 'فاطمة',
    f: 'عبد الله',
    sex: 'f',
    yob: 1990,
    phone: '921000106',
    payam: 'CE-JUB-KAT',
    src: 'officer',
    status: 'verified',
    officer: 1,
    nid: '99E8890011',
    lang: 'ar-juba',
    createdDaysAgo: 47,
    sync: 'synced',
    farms: [{ targetHa: 0.4, accuracy: 'poor', gps: 22, crops: ['sesame'], centre: C(7) }],
  },
  {
    g: 'Rebecca',
    f: 'Kiden',
    sex: 'f',
    yob: 1986,
    phone: '921000107',
    payam: 'CE-JUB-MUN',
    src: 'officer',
    status: 'verified',
    officer: 2,
    nid: '99F3345566',
    lang: 'en',
    createdDaysAgo: 29,
    sync: 'synced',
    farms: [
      { targetHa: 1.4, accuracy: 'good', gps: 6, crops: ['groundnut', 'cowpea'], centre: C(8) },
    ],
  },
  {
    g: 'Emmanuel',
    f: 'Taban',
    sex: 'm',
    yob: 1968,
    phone: '921000108',
    payam: 'CE-JUB-REJ',
    src: 'officer',
    status: 'verified',
    officer: 3,
    nid: '99G1200349',
    lang: 'en',
    createdDaysAgo: 71,
    sync: 'synced',
    farms: [{ targetHa: 2.1, accuracy: 'good', gps: 5, crops: ['sorghum'], centre: C(9) }],
  },
  {
    g: 'Josephine',
    f: 'Poni',
    sex: 'f',
    yob: 1993,
    phone: '921000109',
    payam: 'CE-JUB-NBA',
    src: 'officer',
    status: 'verified',
    officer: 4,
    nid: null,
    lang: 'en',
    createdDaysAgo: 26,
    sync: 'synced',
    farms: [{ targetHa: 0.7, accuracy: 'good', gps: 8, crops: ['maize'], centre: C(10) }],
  },
  {
    g: 'David',
    f: 'Sebit',
    sex: 'm',
    yob: 1981,
    phone: '921000110',
    payam: 'CE-JUB-KAT',
    src: 'officer',
    status: 'verified',
    officer: 1,
    nid: '99H9988770',
    lang: 'en',
    createdDaysAgo: 44,
    sync: 'synced',
    farms: [
      { targetHa: 1.6, accuracy: 'good', gps: 6, crops: ['sesame', 'groundnut'], centre: C(11) },
    ],
  },

  // — pending within 7 days —
  {
    g: 'Agnes',
    f: 'Yar',
    sex: 'f',
    yob: 1997,
    phone: '921000111',
    payam: 'CE-JUB-MUN',
    src: 'officer',
    status: 'pending',
    officer: 2,
    nid: null,
    lang: 'en',
    createdDaysAgo: 3,
    sync: 'synced',
    farms: [{ targetHa: 0.8, accuracy: 'good', gps: 7, crops: ['groundnut'], centre: C(12) }],
  },
  {
    g: 'Simon',
    f: 'Deng',
    sex: 'm',
    yob: 1975,
    phone: '921000112',
    payam: 'CE-JUB-REJ',
    src: 'officer',
    status: 'pending',
    officer: 3,
    nid: '99J4455661',
    lang: 'en',
    createdDaysAgo: 5,
    sync: 'sending',
    farms: [{ targetHa: 1.9, accuracy: 'good', gps: 5, crops: ['sorghum'], centre: C(13) }],
  },
  {
    g: 'Nadia',
    f: 'Kuku',
    sex: 'f',
    yob: 2001,
    phone: '921000113',
    payam: 'CE-JUB-NBA',
    src: 'self',
    status: 'pending',
    officer: null,
    nid: null,
    lang: 'en',
    createdDaysAgo: 2,
    sync: 'waiting',
    farms: [{ targetHa: 0.3, accuracy: 'poor', gps: 18, crops: ['cowpea'], centre: C(14) }],
  },
  {
    g: 'Bakri',
    f: 'Musa',
    sex: 'm',
    yob: 1963,
    phone: '921000114',
    payam: 'CE-JUB-KAT',
    src: 'officer',
    status: 'pending',
    officer: 1,
    nid: '99K7712093',
    lang: 'ar-juba',
    createdDaysAgo: 6,
    sync: 'synced',
    farms: [{ targetHa: 1.2, accuracy: 'good', gps: 9, crops: ['sesame'], centre: C(15) }],
  },

  // — pending PAST 7 days: escalated —
  {
    g: 'Christine',
    f: 'Amaya',
    sex: 'f',
    yob: 1991,
    phone: '921000115',
    payam: 'CE-JUB-MUN',
    src: 'officer',
    status: 'pending',
    officer: 2,
    nid: null,
    lang: 'en',
    createdDaysAgo: 12,
    sync: 'synced',
    farms: [{ targetHa: 0.9, accuracy: 'good', gps: 6, crops: ['groundnut'], centre: C(16) }],
  },
  {
    g: 'Moses',
    f: 'Lako',
    sex: 'm',
    yob: 1958,
    phone: '921000116',
    payam: 'CE-JUB-REJ',
    src: 'officer',
    status: 'pending',
    officer: 3,
    nid: '99L3390022',
    lang: 'en',
    createdDaysAgo: 21,
    sync: 'failed',
    reason: 'server_error',
    farms: [
      {
        targetHa: 2.7,
        points: 5,
        accuracy: 'good',
        gps: 5,
        crops: ['sorghum', 'maize'],
        centre: C(17),
      },
    ],
  },
  {
    g: 'Hanan',
    f: 'Osman',
    sex: 'f',
    yob: 1999,
    phone: '921000117',
    payam: 'CE-JUB-KAT',
    src: 'self',
    status: 'pending',
    officer: null,
    nid: null,
    lang: 'ar-juba',
    createdDaysAgo: 16,
    sync: 'waiting',
    farms: [
      {
        targetHa: 0.5,
        accuracy: 'unusable',
        gps: 41,
        noBoundary: true,
        crops: ['sesame'],
        centre: C(18),
      },
    ],
  },
  {
    g: 'Isaac',
    f: 'Wani',
    sex: 'm',
    yob: 1987,
    phone: '921000118',
    payam: 'CE-JUB-NBA',
    src: 'officer',
    status: 'pending',
    officer: 4,
    nid: '99M8801245',
    lang: 'en',
    createdDaysAgo: 9,
    sync: 'synced',
    resubmitted: true,
    farms: [{ targetHa: 1.3, accuracy: 'good', gps: 7, crops: ['maize'], centre: C(19) }],
  },

  // — duplicate: SAME PHONE as Simon Deng (index 12) —
  {
    g: 'Susan',
    f: 'Deng',
    sex: 'f',
    yob: 1994,
    phone: '921000112',
    payam: 'CE-JUB-REJ',
    src: 'self',
    status: 'pending',
    officer: null,
    nid: null,
    lang: 'en',
    createdDaysAgo: 4,
    sync: 'waiting',
    farms: [{ targetHa: 0.6, accuracy: 'poor', gps: 15, crops: ['cowpea'], centre: C(20) }],
  },

  // — duplicate: SAME NAME + PAYAM as Grace Nyandeng (index 4) —
  {
    g: 'Grace',
    f: 'Nyandeng',
    sex: 'f',
    yob: 1996,
    phone: '921000119',
    payam: 'CE-JUB-MUN',
    src: 'officer',
    status: 'pending',
    officer: 2,
    nid: null,
    lang: 'en',
    createdDaysAgo: 8,
    sync: 'sending',
    farms: [{ targetHa: 0.7, accuracy: 'good', gps: 8, crops: ['groundnut'], centre: C(21) }],
  },

  // — rejected —
  {
    g: 'Thomas',
    f: 'Gore',
    sex: 'm',
    yob: 1990,
    phone: '921000120',
    payam: 'CE-JUB-REJ',
    src: 'officer',
    status: 'rejected',
    officer: 3,
    nid: null,
    lang: 'en',
    createdDaysAgo: 34,
    sync: 'synced',
    reject:
      'National ID could not be confirmed and no farm boundary was captured. Re-register with either an ID or a walked boundary.',
    farms: [
      {
        targetHa: 0.4,
        accuracy: 'unusable',
        gps: 55,
        noBoundary: true,
        crops: ['sorghum'],
        centre: C(22),
      },
    ],
  },
  {
    g: 'Betty',
    f: 'Achan',
    sex: 'f',
    yob: 2003,
    phone: '921000121',
    payam: 'CE-JUB-KAT',
    src: 'self',
    status: 'rejected',
    officer: null,
    nid: null,
    lang: 'en',
    createdDaysAgo: 40,
    sync: 'synced',
    reject:
      'Under the programme age floor for a lead farmer; recorded but not counted toward reach.',
    farms: [],
  },

  // — merged: this duplicate points at Mary Aluel (index 1) as survivor —
  {
    g: 'Mary',
    f: 'Aluat',
    sex: 'f',
    yob: 1988,
    phone: '921000122',
    payam: 'CE-JUB-REJ',
    src: 'self',
    status: 'pending',
    officer: null,
    nid: null,
    lang: 'en',
    createdDaysAgo: 30,
    sync: 'synced',
    mergedIntoIdx: 1,
    farms: [{ targetHa: 1.7, accuracy: 'poor', gps: 19, crops: ['sorghum'], centre: C(1) }],
  },

  // — more verified / pending to fill the register —
  {
    g: 'Daniel',
    f: 'Juma',
    sex: 'm',
    yob: 1982,
    phone: '921000123',
    payam: 'CE-JUB-MUN',
    src: 'officer',
    status: 'verified',
    officer: 2,
    nid: '99N5567781',
    lang: 'en',
    createdDaysAgo: 55,
    sync: 'synced',
    farms: [
      { targetHa: 1.0, accuracy: 'good', gps: 6, crops: ['groundnut', 'maize'], centre: C(23) },
    ],
  },
  {
    g: 'Rose',
    f: 'Iko',
    sex: 'f',
    yob: 1998,
    phone: '921000124',
    payam: 'CE-JUB-NBA',
    src: 'officer',
    status: 'verified',
    officer: 4,
    nid: null,
    lang: 'en',
    createdDaysAgo: 49,
    sync: 'synced',
    farms: [{ targetHa: 0.8, accuracy: 'good', gps: 7, crops: ['maize'], centre: C(24) }],
  },
  {
    g: 'Yusuf',
    f: 'Idris',
    sex: 'm',
    yob: 1970,
    phone: '921000125',
    payam: 'CE-JUB-KAT',
    src: 'officer',
    status: 'verified',
    officer: 1,
    nid: '99P2234981',
    lang: 'ar-juba',
    createdDaysAgo: 63,
    sync: 'synced',
    farms: [
      {
        targetHa: 2.2,
        points: 5,
        accuracy: 'good',
        gps: 5,
        crops: ['sesame', 'sorghum'],
        centre: C(25),
      },
    ],
  },
  {
    g: 'Lily',
    f: 'Modi',
    sex: 'f',
    yob: 1992,
    phone: '921000126',
    payam: 'CE-JUB-REJ',
    src: 'officer',
    status: 'verified',
    officer: 3,
    nid: '99Q9911002',
    lang: 'en',
    createdDaysAgo: 36,
    sync: 'synced',
    farms: [{ targetHa: 1.5, accuracy: 'good', gps: 6, crops: ['cowpea'], centre: C(26) }],
  },
  {
    g: 'Michael',
    f: 'Bul',
    sex: 'm',
    yob: 1977,
    phone: '921000127',
    payam: 'CE-JUB-MUN',
    src: 'officer',
    status: 'verified',
    officer: 2,
    nid: '99R4478123',
    lang: 'en',
    createdDaysAgo: 58,
    sync: 'synced',
    farms: [{ targetHa: 1.9, accuracy: 'good', gps: 5, crops: ['groundnut'], centre: C(27) }],
  },
  {
    g: 'Esther',
    f: 'Lujang',
    sex: 'f',
    yob: 2000,
    phone: '921000128',
    payam: 'CE-JUB-NBA',
    src: 'self',
    status: 'pending',
    officer: null,
    nid: null,
    lang: 'en',
    createdDaysAgo: 1,
    sync: 'waiting',
    farms: [{ targetHa: 0.3, accuracy: 'poor', gps: 24, crops: ['cowpea'], centre: C(28) }],
  },
  {
    g: 'Samuel',
    f: 'Kenyi',
    sex: 'm',
    yob: 1985,
    phone: '921000129',
    payam: 'CE-JUB-REJ',
    src: 'officer',
    status: 'verified',
    officer: 3,
    nid: '99S3312890',
    lang: 'en',
    createdDaysAgo: 45,
    sync: 'synced',
    farms: [
      {
        targetHa: 2.5,
        points: 5,
        accuracy: 'good',
        gps: 4,
        crops: ['sorghum', 'sesame'],
        centre: C(29),
      },
    ],
  },
  {
    g: 'Nyakong',
    f: 'Gatwech',
    sex: 'f',
    yob: 1989,
    phone: '921000130',
    payam: 'CE-JUB-KAT',
    src: 'officer',
    status: 'verified',
    officer: 1,
    nid: null,
    lang: 'en',
    createdDaysAgo: 51,
    sync: 'synced',
    farms: [{ targetHa: 1.1, accuracy: 'good', gps: 8, crops: ['maize'], centre: C(30) }],
  },
  {
    g: 'Robert',
    f: 'Lomingo',
    sex: 'm',
    yob: 1966,
    phone: '921000131',
    payam: 'CE-JUB-MUN',
    src: 'officer',
    status: 'verified',
    officer: 2,
    nid: '99T7789004',
    lang: 'en',
    createdDaysAgo: 67,
    sync: 'synced',
    farms: [
      { targetHa: 1.4, accuracy: 'good', gps: 6, crops: ['groundnut', 'cowpea'], centre: C(31) },
    ],
  },
  {
    g: 'Amina',
    f: 'Hassan',
    sex: 'f',
    yob: 1994,
    phone: '921000132',
    payam: 'CE-JUB-KAT',
    src: 'officer',
    status: 'pending',
    officer: 1,
    nid: null,
    lang: 'ar-juba',
    createdDaysAgo: 4,
    sync: 'synced',
    farms: [{ targetHa: 0.6, accuracy: 'good', gps: 9, crops: ['sesame'], centre: C(32) }],
  },
  {
    g: 'Charles',
    f: 'Data',
    sex: 'm',
    yob: 1983,
    phone: '921000133',
    payam: 'CE-JUB-NBA',
    src: 'officer',
    status: 'verified',
    officer: 4,
    nid: '99U1145678',
    lang: 'en',
    createdDaysAgo: 42,
    sync: 'synced',
    farms: [
      { targetHa: 1.7, accuracy: 'good', gps: 5, crops: ['maize', 'sorghum'], centre: C(33) },
    ],
  },
  {
    g: 'Faiza',
    f: 'Ahmed',
    sex: 'f',
    yob: 1996,
    phone: '921000134',
    payam: 'CE-JUB-KAT',
    src: 'self',
    status: 'pending',
    officer: null,
    nid: null,
    lang: 'ar-juba',
    createdDaysAgo: 14,
    sync: 'failed',
    reason: 'no_network',
    farms: [{ targetHa: 0.5, accuracy: 'poor', gps: 20, crops: ['sesame'], centre: C(34) }],
  },
  {
    g: 'George',
    f: 'Loro',
    sex: 'm',
    yob: 1978,
    phone: '921000135',
    payam: 'CE-JUB-REJ',
    src: 'officer',
    status: 'verified',
    officer: 3,
    nid: '99V6634019',
    lang: 'en',
    createdDaysAgo: 39,
    sync: 'synced',
    farms: [{ targetHa: 2.0, accuracy: 'good', gps: 6, crops: ['sorghum'], centre: C(35) }],
  },
  {
    g: 'Winnie',
    f: 'Adau',
    sex: 'f',
    yob: 2002,
    phone: '921000136',
    payam: 'CE-JUB-MUN',
    src: 'officer',
    status: 'verified',
    officer: 2,
    nid: null,
    lang: 'en',
    createdDaysAgo: 31,
    sync: 'synced',
    farms: [{ targetHa: 0.9, accuracy: 'good', gps: 7, crops: ['groundnut'], centre: C(36) }],
  },
  {
    g: 'Philip',
    f: 'Ohisa',
    sex: 'm',
    yob: 1973,
    phone: '921000137',
    payam: 'CE-JUB-NBA',
    src: 'officer',
    status: 'verified',
    officer: 4,
    nid: '99W2290871',
    lang: 'en',
    createdDaysAgo: 64,
    sync: 'synced',
    farms: [
      {
        targetHa: 2.8,
        points: 5,
        accuracy: 'good',
        gps: 4,
        crops: ['maize', 'cowpea'],
        centre: C(37),
      },
    ],
  },
  {
    g: 'Sandra',
    f: 'Keji',
    sex: 'f',
    yob: 1990,
    phone: '921000138',
    payam: 'CE-JUB-KAT',
    src: 'officer',
    status: 'verified',
    officer: 1,
    nid: '99X5567234',
    lang: 'en',
    createdDaysAgo: 48,
    sync: 'synced',
    farms: [
      { targetHa: 1.2, accuracy: 'good', gps: 6, crops: ['sesame', 'groundnut'], centre: C(38) },
    ],
  },
  {
    g: 'Andrew',
    f: 'Tombe',
    sex: 'm',
    yob: 1980,
    phone: '921000139',
    payam: 'CE-JUB-REJ',
    src: 'officer',
    status: 'pending',
    officer: 3,
    nid: '99Y1178903',
    lang: 'en',
    createdDaysAgo: 11,
    sync: 'synced',
    farms: [{ targetHa: 1.6, accuracy: 'good', gps: 5, crops: ['sorghum'], centre: C(39) }],
  },
  {
    g: 'Margaret',
    f: 'Ropani',
    sex: 'f',
    yob: 1995,
    phone: '921000140',
    payam: 'CE-JUB-MUN',
    src: 'officer',
    status: 'verified',
    officer: 2,
    nid: null,
    lang: 'en',
    createdDaysAgo: 37,
    sync: 'synced',
    farms: [
      { targetHa: 0.8, accuracy: 'good', gps: 8, crops: ['groundnut', 'maize'], centre: C(40) },
    ],
  },

  // — out-of-state (Western Equatoria): only admin should see these —
  {
    g: 'Paul',
    f: 'Bagara',
    sex: 'm',
    yob: 1984,
    phone: '921000141',
    payam: 'WE-YAM-YAM',
    src: 'officer',
    status: 'verified',
    officer: 0,
    nid: '99Z3312004',
    lang: 'en',
    createdDaysAgo: 53,
    sync: 'synced',
    farms: [{ targetHa: 2.3, accuracy: 'good', gps: 6, crops: ['maize'], centre: [28.4, 4.57] }],
  },
  {
    g: 'Joyce',
    f: 'Bakhita',
    sex: 'f',
    yob: 1991,
    phone: '921000142',
    payam: 'WE-MRD-MRD',
    src: 'officer',
    status: 'pending',
    officer: 0,
    nid: null,
    lang: 'en',
    createdDaysAgo: 18,
    sync: 'synced',
    farms: [
      { targetHa: 0.7, accuracy: 'poor', gps: 21, crops: ['groundnut'], centre: [29.47, 4.92] },
    ],
  },
];

/* ---- Materialise ----------------------------------------------------- */

function paddedNumber(state: string, n: number): string {
  const prefix = state === 'CE' ? 'CE-JUB' : state === 'WE' ? 'WE-YAM' : `${state}-XXX`;
  return `${prefix}-${String(n).padStart(6, '0')}`;
}

const consents: Consent[] = [];
const verificationEvents: VerificationEvent[] = [];
const syncRecords: SyncRecord[] = [];
const farms: Farm[] = [];
const cropDeclarations: CropDeclaration[] = [];
const auditEvents: AuditEvent[] = [];

let farmCounter = 0;
let declCounter = 0;
let eventCounter = 0;
let syncCounter = 0;
let auditCounter = 0;

const farmers: Farmer[] = SEEDS.map((seed, i) => {
  const n = i + 1;
  const state = payamState(seed.payam);
  const farmerId = fid(n);
  const consentId = uid(1000 + n);
  const createdAt = daysAgoIso(seed.createdDaysAgo);

  consents.push({
    id: consentId,
    farmer_id: farmerId,
    text_version: seed.lang === 'ar-juba' ? 'v1.0-ar-juba' : 'v1.0-en',
    language: seed.lang,
    granted: true,
    granted_at: createdAt,
    withdrawn_at: null,
  });

  return {
    id: farmerId,
    farmer_number: paddedNumber(state, 100 + n),
    given_name: seed.g,
    family_name: seed.f,
    sex: seed.sex,
    year_of_birth: seed.yob,
    phone: `+211${seed.phone}`,
    national_id: seed.nid,
    payam_id: seed.payam,
    state_id: state,
    registered_by: seed.officer === null ? null : OFFICERS[seed.officer]!.id,
    registration_source: seed.src,
    verification_status: seed.status,
    merged_into: seed.mergedIntoIdx ? fid(seed.mergedIntoIdx) : null,
    consent_id: consentId,
    created_at: createdAt,
  };
});

SEEDS.forEach((seed, i) => {
  const farmer = farmers[i]!;
  const officerId = seed.officer === null ? OFFICERS[0]!.id : OFFICERS[seed.officer]!.id;
  const device =
    seed.officer === null ? 'self-web' : `device-${String(seed.officer + 1).padStart(2, '0')}`;

  // Farms + crop declarations
  seed.farms.forEach((spec, fi) => {
    farmCounter += 1;
    const farmId = farmid(farmCounter);
    const [lon, lat] = spec.centre;
    const ring = spec.noBoundary
      ? null
      : makeRing(farmCounter * 7919 + 13, lon, lat, spec.targetHa, spec.points ?? 4);
    const area = ring ? Number(ringAreaHa(ring, lat).toFixed(2)) : spec.targetHa;
    farms.push({
      id: farmId,
      farmer_id: farmer.id,
      boundary: ring ? { type: 'Polygon', coordinates: [ring] } : null,
      centroid: { lon, lat },
      area_ha: area,
      point_count: ring ? ring.length - 1 : 0,
      gps_accuracy_m: spec.gps,
      accuracy_flag: spec.accuracy,
      mapped_by: officerId,
      mapped_at: daysAgoIso(seed.createdDaysAgo - fi),
      season: SEASON,
    });
    spec.crops.forEach((crop) => {
      declCounter += 1;
      cropDeclarations.push({
        id: cid(5000 + declCounter),
        farm_id: farmId,
        crop,
        season: SEASON,
        declared_at: daysAgoIso(seed.createdDaysAgo - fi),
      });
    });

    // A farm sync record for a couple of officers, to show per-device state.
    if (fi === 0) {
      syncCounter += 1;
      syncRecords.push({
        id: farmid(9000 + syncCounter),
        entity_type: 'farm',
        entity_id: farmId,
        device_id: device,
        officer_id: officerId,
        sync_status: seed.sync,
        reason_code: seed.sync === 'failed' ? (seed.reason ?? 'server_error') : null,
        attempt_count: seed.sync === 'failed' ? 3 : 1,
        acknowledged_at: seed.sync === 'synced' ? daysAgoIso(seed.createdDaysAgo - 1) : null,
      });
    }
  });

  // Farmer sync record
  syncCounter += 1;
  syncRecords.push({
    id: farmid(9000 + syncCounter),
    entity_type: 'farmer',
    entity_id: farmer.id,
    device_id: device,
    officer_id: officerId,
    sync_status: seed.sync,
    reason_code: seed.sync === 'failed' ? (seed.reason ?? 'server_error') : null,
    attempt_count: seed.sync === 'failed' ? 3 : seed.sync === 'sending' ? 2 : 1,
    acknowledged_at: seed.sync === 'synced' ? farmer.created_at : null,
  });

  // Verification events + audit
  const daysWaiting = Math.max(0, seed.createdDaysAgo - (seed.status === 'pending' ? 0 : 4));
  if (seed.resubmitted) {
    eventCounter += 1;
    verificationEvents.push({
      id: uid(2000 + eventCounter),
      farmer_id: farmer.id,
      reviewer_id: SUPERVISOR_ID,
      decision: 'rejected',
      merge_target_id: null,
      reason:
        'Farm boundary missing on first submission. Returned to the officer to walk the plot.',
      days_waiting: seed.createdDaysAgo + 6,
      decided_at: daysAgoIso(seed.createdDaysAgo + 3),
    });
  }
  if (seed.status === 'verified') {
    eventCounter += 1;
    verificationEvents.push({
      id: uid(2000 + eventCounter),
      farmer_id: farmer.id,
      reviewer_id: SUPERVISOR_ID,
      decision: 'verified',
      merge_target_id: null,
      reason: null,
      days_waiting: daysWaiting,
      decided_at: daysAgoIso(Math.max(0, seed.createdDaysAgo - 4)),
    });
  } else if (seed.status === 'rejected') {
    eventCounter += 1;
    verificationEvents.push({
      id: uid(2000 + eventCounter),
      farmer_id: farmer.id,
      reviewer_id: SUPERVISOR_ID,
      decision: 'rejected',
      merge_target_id: null,
      reason: seed.reject ?? 'Rejected.',
      days_waiting: daysWaiting,
      decided_at: daysAgoIso(Math.max(0, seed.createdDaysAgo - 4)),
    });
  }
  if (seed.mergedIntoIdx) {
    eventCounter += 1;
    verificationEvents.push({
      id: uid(2000 + eventCounter),
      farmer_id: farmer.id,
      reviewer_id: SUPERVISOR_ID,
      decision: 'merged',
      merge_target_id: fid(seed.mergedIntoIdx),
      reason: 'Same household and plot as the survivor; duplicate self-registration merged.',
      days_waiting: daysWaiting,
      decided_at: daysAgoIso(Math.max(0, seed.createdDaysAgo - 6)),
    });
  }

  auditCounter += 1;
  auditEvents.push({
    id: uid(3000 + auditCounter),
    entity_type: 'farmer',
    entity_id: farmer.id,
    actor_id: officerId,
    action: 'farmer_registered',
    device_id: device,
    occurred_at: farmer.created_at,
  });
  if (seed.status !== 'pending') {
    auditCounter += 1;
    auditEvents.push({
      id: uid(3000 + auditCounter),
      entity_type: 'farmer',
      entity_id: farmer.id,
      actor_id: SUPERVISOR_ID,
      action: seed.status === 'verified' ? 'farmer_verified' : 'farmer_rejected',
      device_id: null,
      occurred_at: daysAgoIso(Math.max(0, seed.createdDaysAgo - 4)),
    });
  }
});

/* ---- Cooperative memberships (verified farmers only) ----------------- */

export const COOP_MEMBERS: readonly CooperativeMember[] = [
  { cooperative_id: cid(1), farmer_id: fid(1), role: 'chair', joined_at: daysAgoIso(400) },
  { cooperative_id: cid(1), farmer_id: fid(2), role: 'member', joined_at: daysAgoIso(360) },
  { cooperative_id: cid(1), farmer_id: fid(8), role: 'treasurer', joined_at: daysAgoIso(380) },
  { cooperative_id: cid(1), farmer_id: fid(29), role: 'member', joined_at: daysAgoIso(200) },
  { cooperative_id: cid(2), farmer_id: fid(4), role: 'secretary', joined_at: daysAgoIso(300) },
  { cooperative_id: cid(2), farmer_id: fid(7), role: 'chair', joined_at: daysAgoIso(500) },
  { cooperative_id: cid(2), farmer_id: fid(27), role: 'member', joined_at: daysAgoIso(150) },
  { cooperative_id: cid(3), farmer_id: fid(3), role: 'member', joined_at: daysAgoIso(220) },
  { cooperative_id: cid(3), farmer_id: fid(25), role: 'chair', joined_at: daysAgoIso(260) },
  { cooperative_id: cid(4), farmer_id: fid(5), role: 'member', joined_at: daysAgoIso(180) },
  { cooperative_id: cid(4), farmer_id: fid(33), role: 'treasurer', joined_at: daysAgoIso(140) },
];

/* ---- Exports --------------------------------------------------------- */

export const FARMERS: readonly Farmer[] = farmers;
export const FARMS: readonly Farm[] = farms;
export const CROP_DECLARATIONS: readonly CropDeclaration[] = cropDeclarations;
export const CONSENTS: readonly Consent[] = consents;
export const VERIFICATION_EVENTS: readonly VerificationEvent[] = verificationEvents;
export const SYNC_RECORDS: readonly SyncRecord[] = syncRecords;
export const AUDIT_EVENTS: readonly AuditEvent[] = auditEvents;

/* ---- Lookups --------------------------------------------------------- */

export function farmerById(id: string): Farmer | undefined {
  return FARMERS.find((f) => f.id === id);
}
export function officerById(id: string | null): Officer | undefined {
  return id ? OFFICERS.find((o) => o.id === id) : undefined;
}
/** Active officers in a payam — the only officers a farmer there can be
 *  reassigned to (C-8R.2). The server enforces the same rule. */
export function activeOfficersInPayam(payamId: string): Officer[] {
  return OFFICERS.filter((o) => o.status === 'active' && o.payam_id === payamId);
}
export function userById(id: string): User | undefined {
  return USERS.find((u) => u.id === id);
}
export function coopById(id: string): Cooperative | undefined {
  return COOPERATIVES.find((c) => c.id === id);
}
export function farmsForFarmer(farmerId: string): Farm[] {
  return FARMS.filter((f) => f.farmer_id === farmerId);
}
export function cropsForFarm(farmId: string): CropDeclaration[] {
  return CROP_DECLARATIONS.filter((d) => d.farm_id === farmId);
}
export function consentForFarmer(farmerId: string): Consent | undefined {
  return CONSENTS.find((c) => c.farmer_id === farmerId);
}
export function eventsForFarmer(farmerId: string): VerificationEvent[] {
  return VERIFICATION_EVENTS.filter((e) => e.farmer_id === farmerId).sort((a, b) =>
    a.decided_at.localeCompare(b.decided_at),
  );
}
export function syncForEntity(entityId: string): SyncRecord[] {
  return SYNC_RECORDS.filter((s) => s.entity_id === entityId);
}
export function auditForEntity(entityId: string): AuditEvent[] {
  return AUDIT_EVENTS.filter((a) => a.entity_id === entityId).sort((a, b) =>
    b.occurred_at.localeCompare(a.occurred_at),
  );
}
export function membershipsForFarmer(farmerId: string): CooperativeMember[] {
  return COOP_MEMBERS.filter((m) => m.farmer_id === farmerId);
}
export function cropsForFarmer(farmerId: string): Crop[] {
  const farmIds = new Set(farmsForFarmer(farmerId).map((f) => f.id));
  const crops = new Set<Crop>();
  for (const d of CROP_DECLARATIONS) if (farmIds.has(d.farm_id)) crops.add(d.crop);
  return [...crops];
}
export function totalAreaHa(farmerId: string): number {
  return Number(
    farmsForFarmer(farmerId)
      .reduce((sum, f) => sum + f.area_ha, 0)
      .toFixed(2),
  );
}
export function caseloadCount(officerId: string): number {
  return FARMERS.filter((f) => f.registered_by === officerId && f.merged_into === null).length;
}

export { CE_PAYAM_IDS };
