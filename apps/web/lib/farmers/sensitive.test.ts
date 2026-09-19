import { describe, expect, it } from 'vitest';

import { toFarmer } from './api';
import { effectiveStatus, canRegister, canReview, STATUS_LABEL } from './presentation';

/**
 * C-5.8 AND C-6.8 AT THE CLIENT BOUNDARY.
 *
 * The route decides who may read a national ID and enforces it by OMITTING the
 * key. Everything downstream of that decision depends on the omission
 * surviving the trip through this client — and it did not: `toFarmer` used to
 * read `row.national_id ?? null`, which turned "you were not told" into "this
 * farmer has none", and the dossier then printed "None recorded" at a
 * supervisor who was never sent the field.
 */

const row = (patch: Record<string, unknown> = {}) =>
  ({
    id: 'f1',
    farmer_number: 'CE-JUB-000001',
    given_name: 'Zztest',
    family_name: 'Zzfamily',
    sex: 'f',
    year_of_birth: 1990,
    phone: '+211912345678',
    payam_id: 'CE-JUB-MUN',
    state_id: 'CE',
    registered_by: 'o1',
    caseload_officer_id: 'o1',
    registration_source: 'officer',
    verification_status: 'verified',
    merged_into: null,
    consent: { id: 'c1' },
    created_at: '2026-09-01T00:00:00.000Z',
    ...patch,
  }) as Parameters<typeof toFarmer>[0];

describe('the national ID survives the trip with its three states intact', () => {
  it('a withheld field stays ABSENT, so the screen can decline to render a row', () => {
    const farmer = toFarmer(row());
    expect('national_id' in farmer).toBe(false);
    expect(farmer.national_id).toBeUndefined();
  });

  it('an explicit null stays null — measured, and this farmer has none', () => {
    const farmer = toFarmer(row({ national_id: null }));
    expect('national_id' in farmer).toBe(true);
    expect(farmer.national_id).toBeNull();
  });

  it('a value the caller is entitled to arrives whole, not masked', () => {
    // The route already withheld it from everyone not entitled to read it, so
    // masking here would blind the one reader the rule exists to serve.
    const farmer = toFarmer(row({ national_id: 'SSD-1234567' }));
    expect(farmer.national_id).toBe('SSD-1234567');
    expect(farmer.national_id).not.toContain('•');
    expect(farmer.national_id).not.toContain('*');
  });

  it('absent and null are not the same value', () => {
    expect(toFarmer(row()).national_id).not.toBe(toFarmer(row({ national_id: null })).national_id);
  });
});

describe('the duplicate flag is an indication the route already computes', () => {
  it('is carried through when the route sends it', () => {
    expect(toFarmer(row({ duplicate_flag: true })).duplicate_flag).toBe(true);
    expect(toFarmer(row({ duplicate_flag: false })).duplicate_flag).toBe(false);
  });

  it('stays absent rather than becoming false when the route does not send it', () => {
    // false would say "checked, and it is not a duplicate". Absent says
    // "not told", which is the truth.
    expect(toFarmer(row()).duplicate_flag).toBeUndefined();
  });
});

describe('status is never laundered', () => {
  it('a merged record reads as merged, never as its underlying status', () => {
    const merged = toFarmer(row({ merged_into: 'f2', verification_status: 'verified' }));
    expect(effectiveStatus(merged)).toBe('merged');
    expect(STATUS_LABEL[effectiveStatus(merged)]).toBe('Merged');
  });

  it('pending and rejected keep their own words', () => {
    expect(STATUS_LABEL[effectiveStatus(toFarmer(row({ verification_status: 'pending' })))]).toBe(
      STATUS_LABEL.pending,
    );
    expect(STATUS_LABEL[effectiveStatus(toFarmer(row({ verification_status: 'rejected' })))]).toBe(
      STATUS_LABEL.rejected,
    );
  });

  it('every status has a label that reads without colour', () => {
    for (const [key, label] of Object.entries(STATUS_LABEL)) {
      expect(label.length, `${key} has no readable label`).toBeGreaterThan(0);
    }
  });
});

describe('who is offered which action', () => {
  it('only an administrator and a supervisor may decide a registration', () => {
    expect(canReview('admin')).toBe(true);
    expect(canReview('supervisor')).toBe(true);
    expect(canReview('officer')).toBe(false);
    expect(canReview('read_only')).toBe(false);
  });

  it('only an administrator and an officer may register one', () => {
    expect(canRegister('admin')).toBe(true);
    expect(canRegister('officer')).toBe(true);
    expect(canRegister('supervisor')).toBe(false);
    expect(canRegister('read_only')).toBe(false);
  });
});
