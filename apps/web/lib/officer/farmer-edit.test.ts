import { describe, expect, it } from 'vitest';

import { patchFarmerSchema } from '@agri-erp/shared';

import {
  canMoveToMyPayam,
  draftFrom,
  EDITABLE_FIELDS,
  editEligibility,
  isEmptyPatch,
  mayEditNationalId,
  patchBody,
} from './farmer-edit';
import type { Farmer } from '@/lib/fixtures/farmers';

const MY_PAYAM = 'CE-JUB-MUN';

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
    payam_id: MY_PAYAM,
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

describe('the editable fields come from the schema, not from a hand-written list', () => {
  it('is exactly what patchFarmerSchema accepts', () => {
    expect([...EDITABLE_FIELDS].sort()).toEqual(Object.keys(patchFarmerSchema.shape).sort());
  });

  it('does not include anything that would escalate privilege', () => {
    for (const forbidden of [
      'verification_status',
      'caseload_officer_id',
      'merged_into',
      'registered_by',
      'farmer_number',
    ]) {
      expect(EDITABLE_FIELDS).not.toContain(forbidden);
    }
  });

  it('the schema itself refuses such a field, so the form is not the only guard', () => {
    const escalation = patchFarmerSchema.safeParse({ verification_status: 'verified' });
    expect(escalation.success).toBe(false);
  });
});

describe('who may be edited, mirroring the route’s status guard', () => {
  it('a pending farmer may be edited', () => {
    expect(editEligibility(farmer({ verification_status: 'pending' }))).toEqual({
      canEdit: true,
      refusal: null,
    });
  });

  it('a rejected farmer may be edited — that is the correction path', () => {
    expect(editEligibility(farmer({ verification_status: 'rejected' })).canEdit).toBe(true);
  });

  it('a verified farmer may NOT: the route answers 403 and the form must agree', () => {
    expect(editEligibility(farmer({ verification_status: 'verified' }))).toEqual({
      canEdit: false,
      refusal: 'not_correctable',
    });
  });

  it('a merged record may not be edited at all', () => {
    expect(editEligibility(farmer({ merged_into: 'other' }))).toEqual({
      canEdit: false,
      refusal: 'merged',
    });
  });
});

describe('the payam move is the one legal location change', () => {
  it('is offered only when the farmer is somewhere else', () => {
    expect(canMoveToMyPayam(farmer({ payam_id: 'CE-JUB-KAT' }), MY_PAYAM)).toBe(true);
    expect(canMoveToMyPayam(farmer({ payam_id: MY_PAYAM }), MY_PAYAM)).toBe(false);
  });

  it('is not offered when the officer’s own payam is unknown', () => {
    expect(canMoveToMyPayam(farmer({ payam_id: 'CE-JUB-KAT' }), null)).toBe(false);
  });

  it('sends the officer’s own payam and never an arbitrary one', () => {
    const body = patchBody(
      farmer({ payam_id: 'CE-JUB-KAT' }),
      { ...draftFrom(farmer({})), moveToMyPayam: true },
      MY_PAYAM,
    );
    expect(body.payam_id).toBe(MY_PAYAM);
  });
});

describe('absent, null and value stay three different things', () => {
  it('a withheld national ID is not editable and never sent', () => {
    const withheld = farmer({});
    delete (withheld as { national_id?: unknown }).national_id;
    expect(mayEditNationalId(withheld)).toBe(false);
    const body = patchBody(withheld, { ...draftFrom(withheld), national_id: 'SSD-9' }, MY_PAYAM);
    expect('national_id' in body).toBe(false);
  });

  it('clearing a present id sends null — the officer said "there is none"', () => {
    const f = farmer({});
    const body = patchBody(f, { ...draftFrom(f), national_id: '' }, MY_PAYAM);
    expect(body.national_id).toBeNull();
  });

  it('an unchanged id is not sent at all', () => {
    const f = farmer({});
    expect('national_id' in patchBody(f, draftFrom(f), MY_PAYAM)).toBe(false);
  });

  it('a farmer whose id is explicitly null starts blank and stays unsent', () => {
    const f = farmer({ national_id: null });
    expect(draftFrom(f).national_id).toBe('');
    expect('national_id' in patchBody(f, draftFrom(f), MY_PAYAM)).toBe(false);
  });
});

describe('the patch carries only what changed', () => {
  it('an untouched form sends nothing, and the screen can say so', () => {
    const f = farmer({});
    const body = patchBody(f, draftFrom(f), MY_PAYAM);
    expect(body).toEqual({});
    expect(isEmptyPatch(body)).toBe(true);
  });

  it('sends one field when one field changed', () => {
    const f = farmer({});
    const body = patchBody(f, { ...draftFrom(f), phone: '+211921000999' }, MY_PAYAM);
    expect(body).toEqual({ phone: '+211921000999' });
  });

  it('trims what it sends, so a stray space is not a change', () => {
    const f = farmer({});
    const body = patchBody(f, { ...draftFrom(f), given_name: '  Nyanchiew  ' }, MY_PAYAM);
    expect(isEmptyPatch(body)).toBe(true);
  });

  it('every body it produces is accepted by the shared schema', () => {
    const f = farmer({});
    const body = patchBody(
      f,
      {
        ...draftFrom(f),
        given_name: 'Nyakuor',
        phone: '+211921000123',
        year_of_birth: '1990',
        national_id: '',
      },
      MY_PAYAM,
    );
    expect(patchFarmerSchema.safeParse(body).success).toBe(true);
  });
});
