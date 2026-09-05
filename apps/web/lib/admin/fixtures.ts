// Sample staff and officers for previewing the administration screens before a
// sign-in endpoint exists (every live call is 401 until B3 auth ships). Not
// real data. The screens read these when NEXT_PUBLIC_USE_LIVE_ADMIN is unset.

import type { AuditEvent, Officer, StaffUser } from './api';

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

/** Sample audit rows for previewing the trail before sign-in exists. */
export const AUDIT_FIXTURE: readonly AuditEvent[] = [
  {
    id: 'a-1',
    entity_type: 'farmer',
    entity_id: 'f-1024',
    actor_type: 'officer',
    actor_id: 'o-1',
    action: 'farmer.created',
    before: null,
    after: { farmer_number: 'CE-JUB-001024' },
    device_id: 'field-tablet-07',
    occurred_at: '2026-09-05T07:42:00Z',
  },
  {
    id: 'a-2',
    entity_type: 'farmer',
    entity_id: 'f-1024',
    actor_type: 'supervisor',
    actor_id: 'u-sup-ce',
    action: 'farmer.verified',
    before: { verification_status: 'pending' },
    after: { verification_status: 'verified' },
    device_id: null,
    occurred_at: '2026-09-05T09:10:00Z',
  },
  {
    id: 'a-3',
    entity_type: 'officer',
    entity_id: 'o-3',
    actor_type: 'admin',
    actor_id: 'u-admin-1',
    action: 'officer.status_changed',
    before: { status: 'active' },
    after: { status: 'inactive' },
    device_id: null,
    occurred_at: '2026-09-04T16:20:00Z',
  },
  {
    id: 'a-4',
    entity_type: 'user',
    entity_id: 'u-sup-we',
    actor_type: 'admin',
    actor_id: 'u-admin-1',
    action: 'user.created',
    before: null,
    after: { role: 'supervisor', state_id: 'WE' },
    device_id: null,
    occurred_at: '2026-07-22T09:00:00Z',
  },
  {
    id: 'a-5',
    entity_type: 'farmer',
    entity_id: 'f-0990',
    actor_type: 'officer',
    actor_id: 'o-2',
    action: 'farmer.updated',
    before: { phone: '+211921000990' },
    after: { phone: '+211921000991' },
    device_id: 'field-tablet-03',
    occurred_at: '2026-09-03T11:35:00Z',
  },
];
