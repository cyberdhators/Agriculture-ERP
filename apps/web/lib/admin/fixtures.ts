// Sample staff and officers for previewing the administration screens before a
// sign-in endpoint exists (every live call is 401 until B3 auth ships). Not
// real data. The screens read these when NEXT_PUBLIC_USE_LIVE_ADMIN is unset.

import type { Officer, StaffUser } from './api';

export const STAFF_FIXTURE: readonly StaffUser[] = [
  {
    id: 'u-admin-1',
    name: 'Achol Deng',
    role: 'admin',
    state_id: null,
    last_login_at: '2026-09-05T07:12:00Z',
    created_at: '2026-06-01T09:00:00Z',
  },
  {
    id: 'u-sup-ce',
    name: 'Peter Lado',
    role: 'supervisor',
    state_id: 'CE',
    last_login_at: '2026-09-04T15:40:00Z',
    created_at: '2026-06-03T09:00:00Z',
  },
  {
    id: 'u-ro-ce',
    name: 'Grace Poni',
    role: 'read_only',
    state_id: 'CE',
    last_login_at: '2026-08-30T11:05:00Z',
    created_at: '2026-06-10T09:00:00Z',
  },
  {
    id: 'u-sup-we',
    name: 'Joseph Taban',
    role: 'supervisor',
    state_id: 'WE',
    last_login_at: null,
    created_at: '2026-07-22T09:00:00Z',
  },
];

export const OFFICERS_FIXTURE: readonly Officer[] = [
  {
    id: 'o-1',
    name: 'Mary Aluel',
    phone: '+211921000301',
    payam_id: 'CE-JUB-REJ',
    state_id: 'CE',
    status: 'active',
    last_sync_at: '2026-09-05T06:50:00Z',
    created_at: '2026-06-15T09:00:00Z',
  },
  {
    id: 'o-2',
    name: 'Emmanuel Taban',
    phone: '+211921000302',
    payam_id: 'CE-JUB-MUN',
    state_id: 'CE',
    status: 'active',
    last_sync_at: '2026-09-03T18:20:00Z',
    created_at: '2026-06-15T09:00:00Z',
  },
  {
    id: 'o-3',
    name: 'Nadia Kuku',
    phone: '+211921000303',
    payam_id: 'CE-JUB-KAT',
    state_id: 'CE',
    status: 'inactive',
    last_sync_at: '2026-07-28T08:00:00Z',
    created_at: '2026-06-20T09:00:00Z',
  },
  {
    id: 'o-4',
    name: 'Paul Bagara',
    phone: '+211921000304',
    payam_id: 'WE-YAM-YAM',
    state_id: 'WE',
    status: 'active',
    last_sync_at: null,
    created_at: '2026-07-25T09:00:00Z',
  },
];

export const STATE_NAMES: Record<string, string> = {
  CE: 'Central Equatoria',
  WE: 'Western Equatoria',
};

export const PAYAM_NAMES: Record<string, string> = {
  'CE-JUB-REJ': 'Rejaf',
  'CE-JUB-MUN': 'Munuki',
  'CE-JUB-KAT': 'Kator',
  'WE-YAM-YAM': 'Yambio',
};
