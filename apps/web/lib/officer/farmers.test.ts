import { describe, expect, it } from 'vitest';

import {
  canResubmit,
  cardFields,
  caseloadSummary,
  filterFor,
  isStatusTab,
  STATUS_TABS,
} from './farmers';
import type { Farmer } from '@/lib/fixtures/farmers';

/** Names and payams from South Sudan, because that is who the caseload holds. */
const farmer = (over: Partial<Farmer>): Farmer =>
  ({
    id: 'f-1',
    farmer_number: 'CE-JUB-000412',
    given_name: 'Nyanchiew',
    family_name: 'Chol',
    sex: 'f',
    year_of_birth: 1991,
    phone: '+211921000412',
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

describe('the status chips filter on the server', () => {
  it('offers exactly All, Pending, Verified and Rejected — no invented state', () => {
    expect(STATUS_TABS.map((t) => t.key)).toEqual(['all', 'pending', 'verified', 'rejected']);
  });

  it('All sends no filter; each other chip sends the API’s own parameter', () => {
    expect(filterFor('all')).toEqual({});
    expect(filterFor('pending')).toEqual({ verification_status: 'pending' });
    expect(filterFor('verified')).toEqual({ verification_status: 'verified' });
    expect(filterFor('rejected')).toEqual({ verification_status: 'rejected' });
  });

  it('rejects a status that is not a chip, so a hand-edited URL cannot smuggle one', () => {
    expect(isStatusTab('merged')).toBe(false);
    expect(isStatusTab('duplicate_flag')).toBe(false);
    expect(isStatusTab(null)).toBe(false);
    expect(isStatusTab('rejected')).toBe(true);
  });
});

describe('resubmission is offered only where the route would accept it', () => {
  it('a rejected farmer may be corrected and resubmitted', () => {
    expect(canResubmit(farmer({ verification_status: 'rejected' }))).toBe(true);
  });

  it('pending and verified may not — those decisions are not the officer’s', () => {
    expect(canResubmit(farmer({ verification_status: 'pending' }))).toBe(false);
    expect(canResubmit(farmer({ verification_status: 'verified' }))).toBe(false);
  });

  it('a merged record may not, whatever its status says: merging is terminal', () => {
    expect(canResubmit(farmer({ verification_status: 'rejected', merged_into: 'other' }))).toBe(
      false,
    );
  });
});

describe('a card shows what the route sent and no more', () => {
  it('keeps an absent national ID ABSENT — not null, not a placeholder (C-5.8)', () => {
    const withheld = farmer({});
    delete (withheld as { national_id?: unknown }).national_id;
    const fields = cardFields(withheld);
    expect('nationalId' in fields).toBe(false);
  });

  it('keeps an explicit null as null: the officer was told, and there is none', () => {
    const fields = cardFields(farmer({ national_id: null }));
    expect('nationalId' in fields).toBe(true);
    expect(fields.nationalId).toBeNull();
  });

  it('passes the id through when the officer is entitled to it', () => {
    expect(cardFields(farmer({ national_id: 'SSD-99001' })).nationalId).toBe('SSD-99001');
  });

  it('a missing phone is null and never a fabricated number', () => {
    expect(cardFields(farmer({ phone: '' })).phone).toBeNull();
  });

  it('surfaces the rejection reason only when the route supplied one', () => {
    expect(cardFields(farmer({ verification_status: 'rejected' })).rejectionReason).toBeNull();
    const withReason = farmer({
      verification_status: 'rejected',
      rejection: { reason_code: 'incomplete', note: null, decided_at: '2026-09-10T00:00:00.000Z' },
    } as Partial<Farmer>);
    expect(cardFields(withReason).rejectionReason).toBe('incomplete');
  });

  it('a merged record reads as merged rather than as its old status', () => {
    const fields = cardFields(farmer({ verification_status: 'verified', merged_into: 'x' }));
    expect(fields.status).toBe('merged');
    expect(fields.merged).toBe(true);
  });
});

describe('the header never calls a page a total', () => {
  it('counts what is held and says it is complete when the route said so', () => {
    const summary = caseloadSummary([farmer({}), farmer({ id: 'f-2' })], false);
    expect(summary).toEqual({ shown: 2, needingAttention: 0, complete: true });
  });

  it('marks the count incomplete when more pages exist', () => {
    expect(caseloadSummary([farmer({})], true).complete).toBe(false);
  });

  it('needing attention counts the rejected, because those are the ones with a move', () => {
    const summary = caseloadSummary(
      [
        farmer({ id: '1', verification_status: 'rejected' }),
        farmer({ id: '2', verification_status: 'pending' }),
        farmer({ id: '3', verification_status: 'rejected', merged_into: 'z' }),
      ],
      false,
    );
    expect(summary.needingAttention).toBe(1);
  });

  it('an empty caseload is zero and complete, not an absent figure', () => {
    expect(caseloadSummary([], false)).toEqual({
      shown: 0,
      needingAttention: 0,
      complete: true,
    });
  });
});
