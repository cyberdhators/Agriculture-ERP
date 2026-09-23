import { describe, expect, it } from 'vitest';

import {
  identityRows,
  officerActions,
  rejectionOf,
  statusOf,
  wasToldNoNationalId,
} from './farmer-detail';
import type { Farmer } from '@/lib/fixtures/farmers';

const farmer = (over: Partial<Farmer>): Farmer =>
  ({
    id: 'f-1',
    farmer_number: 'CE-JUB-000412',
    given_name: 'Nyanchiew',
    family_name: 'Chol',
    sex: 'f',
    year_of_birth: 1991,
    phone: '+211921000412',
    national_id: 'SSD-4471902',
    payam_id: 'CE-JUB-MUN',
    county_id: 'CE-JUB',
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

const keys = (f: Farmer) => identityRows(f).map((r) => r.key);

describe('the officer sees the national ID in full, or not at all (C-5.8)', () => {
  it('renders it whole — never masked, because a mask still says one exists', () => {
    const row = identityRows(farmer({})).find((r) => r.key === 'national_id');
    expect(row?.value).toBe('SSD-4471902');
    expect(row?.value).not.toContain('•');
    expect(row?.value).not.toContain('*');
  });

  it('renders NO row when the key is absent — not a dash, not “none recorded”', () => {
    const withheld = farmer({});
    delete (withheld as { national_id?: unknown }).national_id;
    expect(keys(withheld)).not.toContain('national_id');
    expect(wasToldNoNationalId(withheld)).toBe(false);
  });

  it('distinguishes “told, and there is none” from “not told”', () => {
    expect(wasToldNoNationalId(farmer({ national_id: null }))).toBe(true);
    expect(keys(farmer({ national_id: null }))).not.toContain('national_id');
  });
});

describe('identity rows are built only from what the route sent', () => {
  it('shows the permitted fields the officer needs to identify someone', () => {
    expect(keys(farmer({}))).toEqual([
      'farmer_number',
      'phone',
      'sex',
      'year_of_birth',
      'national_id',
      'state_id',
      'county_id',
      'payam_id',
    ]);
  });

  it('omits a field the route did not send rather than inventing a placeholder', () => {
    const noCounty = farmer({});
    delete (noCounty as { county_id?: unknown }).county_id;
    expect(keys(noCounty)).not.toContain('county_id');
  });

  it('omits an empty phone instead of printing an empty row', () => {
    expect(keys(farmer({ phone: '' }))).not.toContain('phone');
  });

  it('never renders a dash as a value', () => {
    for (const row of identityRows(farmer({}))) {
      expect(row.value).not.toBe('—');
      expect(row.value).not.toBe('-');
    }
  });
});

describe('status', () => {
  it('reads the three states the officer must tell apart', () => {
    expect(statusOf(farmer({ verification_status: 'pending' }))).toBe('pending');
    expect(statusOf(farmer({ verification_status: 'verified' }))).toBe('verified');
    expect(statusOf(farmer({ verification_status: 'rejected' }))).toBe('rejected');
  });

  it('a merged record reads as merged whatever its old status was', () => {
    expect(statusOf(farmer({ verification_status: 'verified', merged_into: 'x' }))).toBe('merged');
  });
});

describe('actions are only what the backend would accept', () => {
  it('a rejected farmer may be corrected and resubmitted', () => {
    expect(officerActions(farmer({ verification_status: 'rejected' })).canResubmit).toBe(true);
  });

  it('pending and verified farmers may not be resubmitted', () => {
    expect(officerActions(farmer({ verification_status: 'pending' })).canResubmit).toBe(false);
    expect(officerActions(farmer({ verification_status: 'verified' })).canResubmit).toBe(false);
  });

  it('a merged record offers nothing at all: merging is terminal', () => {
    const actions = officerActions(farmer({ verification_status: 'rejected', merged_into: 'x' }));
    expect(actions).toEqual({ canResubmit: false, canEdit: false });
  });

  it('the action set has exactly two members — no verify, reject, merge, reassign or remove', () => {
    expect(Object.keys(officerActions(farmer({}))).sort()).toEqual(['canEdit', 'canResubmit']);
  });
});

describe('the rejection reason comes from the route or not at all', () => {
  it('is null when the record is not rejected', () => {
    expect(rejectionOf(farmer({ verification_status: 'pending' }))).toBeNull();
  });

  it('is null when rejected but the route sent no rejection block', () => {
    expect(rejectionOf(farmer({ verification_status: 'rejected' }))).toBeNull();
  });

  it('passes the code, note and moment through without inventing wording', () => {
    const rejected = farmer({
      verification_status: 'rejected',
      rejection: {
        reason_code: 'incomplete',
        note: 'Consent page missing.',
        decided_at: '2026-09-10T09:00:00.000Z',
      },
    } as Partial<Farmer>);
    expect(rejectionOf(rejected)).toEqual({
      reasonCode: 'incomplete',
      note: 'Consent page missing.',
      decidedAt: '2026-09-10T09:00:00.000Z',
    });
  });
});
