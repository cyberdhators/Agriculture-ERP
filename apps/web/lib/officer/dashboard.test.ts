import { describe, expect, it } from 'vitest';

import {
  caseloadCounts,
  dayWindow,
  fetchWindow,
  groupOf,
  needingAttention,
  visitsToday,
} from './dashboard';
import type { Farmer } from '@/lib/fixtures/farmers';

/**
 * The officer dashboard's arithmetic, with names and payams from South Sudan
 * because that is who uses it.
 */
const farmer = (over: Partial<Farmer>): Farmer =>
  ({
    id: over.id ?? 'f-1',
    farmer_number: 'CE-JUB-000001',
    given_name: 'Nyakuor',
    family_name: 'Deng',
    sex: 'f',
    year_of_birth: 1988,
    phone: '+211921000001',
    national_id: null,
    payam_id: 'CE-JUB-MUN',
    state_id: 'CE',
    registered_by: 'o-1',
    caseload_officer_id: 'o-1',
    registration_source: 'officer',
    verification_status: 'pending',
    merged_into: null,
    consent_id: 'c-1',
    created_at: '2026-09-01T08:00:00.000Z',
    preferred_language: 'en',
    ...over,
  }) as Farmer;

describe('the officer’s caseload counts', () => {
  it('counts each state, and a merged record is not a person waiting on anything (C-6.8)', () => {
    const counts = caseloadCounts([
      farmer({ id: '1', verification_status: 'pending' }),
      farmer({ id: '2', verification_status: 'verified' }),
      farmer({ id: '3', verification_status: 'rejected' }),
      farmer({ id: '4', verification_status: 'verified', merged_into: '2' }),
    ]);
    expect(counts).toEqual({ total: 3, pending: 1, rejected: 1, verified: 1, complete: true });
  });

  it('an empty caseload is zeros, not an absent figure', () => {
    expect(caseloadCounts([])).toEqual({
      total: 0,
      pending: 0,
      rejected: 0,
      verified: 0,
      complete: true,
    });
  });

  it('a merged farmer is “merged” whatever its verification status says', () => {
    expect(groupOf({ verification_status: 'verified', merged_into: 'x' } as Farmer)).toBe('merged');
    expect(groupOf({ verification_status: 'rejected', merged_into: null } as Farmer)).toBe(
      'rejected',
    );
  });
});

describe('what the officer has recorded today', () => {
  const now = new Date('2026-09-20T14:30:00.000Z');

  it('the window is the officer’s local day, start inclusive and end exclusive', () => {
    const { from, to } = dayWindow(now);
    expect(new Date(from).getHours()).toBe(0);
    expect(new Date(to).getTime() - new Date(from).getTime()).toBe(86_400_000);
  });

  it('counts visits by the officer’s own moment, and the people behind them', () => {
    const today = dayWindow(now).from;
    const result = visitsToday(
      [
        { id: 'v1', visited_at: today, farmer_id: 'a' },
        { id: 'v2', visited_at: today, farmer_id: 'a' },
        { id: 'v3', visited_at: today, farmer_id: 'b' },
        { id: 'v4', visited_at: '2026-09-19T09:00:00.000Z', farmer_id: 'c' },
      ],
      now,
    );
    // Three visits, two farmers: seeing one farmer twice is two visits and one person.
    expect(result).toEqual({ count: 3, farmersSeen: 2, complete: true });
  });

  it('a day with no visits is zero, which is a fact and not an absence', () => {
    expect(visitsToday([], now)).toEqual({ count: 0, farmersSeen: 0, complete: true });
  });
});

describe('farmers needing attention put the officer’s own work first', () => {
  it('rejected before pending, because resubmission is the only move an officer has', () => {
    const rows = needingAttention([
      farmer({ id: 'p', verification_status: 'pending', created_at: '2026-09-01T00:00:00.000Z' }),
      farmer({ id: 'r', verification_status: 'rejected', created_at: '2026-09-05T00:00:00.000Z' }),
    ]);
    expect(rows.map((r) => r.farmer.id)).toEqual(['r', 'p']);
    expect(rows[0]!.officerCanAct).toBe(true);
    expect(rows[1]!.officerCanAct).toBe(false);
  });

  it('never offers an action on a pending farmer — that decision is not the officer’s', () => {
    const rows = needingAttention([farmer({ id: 'p', verification_status: 'pending' })]);
    expect(rows.every((r) => r.group !== 'pending' || !r.officerCanAct)).toBe(true);
  });

  it('leaves out verified and merged records: neither is waiting on this officer', () => {
    const rows = needingAttention([
      farmer({ id: 'v', verification_status: 'verified' }),
      farmer({ id: 'm', verification_status: 'verified', merged_into: 'v' }),
    ]);
    expect(rows).toEqual([]);
  });

  it('oldest first inside a group, and caps the list so a phone shows a day’s work', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      farmer({
        id: `r${i}`,
        verification_status: 'rejected',
        created_at: `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
      }),
    );
    const rows = needingAttention(many);
    expect(rows).toHaveLength(6);
    expect(rows[0]!.farmer.id).toBe('r0');
  });
});

describe('a page that was cut short is not a total', () => {
  it('caseload counts carry complete: false when the list had more pages', () => {
    const counts = caseloadCounts([farmer({ verification_status: 'verified' })], false);
    expect(counts.complete).toBe(false);
    // The numbers are still returned -- they are a floor, and the screen says so.
    expect(counts.total).toBe(1);
  });

  it('today’s visits carry it too', () => {
    const now = new Date('2026-09-20T14:30:00.000Z');
    expect(visitsToday([], now, false).complete).toBe(false);
  });

  it('the fetch window is a day either side of the day being counted', () => {
    // The server filters received_at; this dashboard counts visited_at. A visit
    // made today and synced tomorrow must still be fetched.
    const now = new Date('2026-09-20T14:30:00.000Z');
    const day = dayWindow(now);
    const wide = fetchWindow(now);
    expect(new Date(day.from).getTime() - new Date(wide.from).getTime()).toBe(86_400_000);
    expect(new Date(wide.to).getTime() - new Date(day.to).getTime()).toBe(86_400_000);
  });
});
