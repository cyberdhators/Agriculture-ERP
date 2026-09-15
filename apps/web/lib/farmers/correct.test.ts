import { describe, expect, it } from 'vitest';

import type { Farmer } from '@/lib/fixtures/farmers';

import { correctionFrom, patchDiff, rejectionOf } from './correct';

const farmer = {
  id: 'f-1',
  given_name: 'Achol',
  family_name: 'Deng',
  sex: 'f',
  year_of_birth: 1990,
  phone: '+211920000001',
  national_id: null,
  verification_status: 'rejected',
} as unknown as Farmer;

describe('patchDiff', () => {
  it('is empty when nothing changed', () => {
    expect(patchDiff(farmer, correctionFrom(farmer))).toEqual({});
  });

  it('carries only the changed fields, trimmed and typed', () => {
    const v = { ...correctionFrom(farmer), family_name: ' Deng Majok ', year_of_birth: '1991' };
    expect(patchDiff(farmer, v)).toEqual({ family_name: 'Deng Majok', year_of_birth: 1991 });
  });

  it('reads an emptied national id as none and a typed one as a change', () => {
    expect(patchDiff(farmer, { ...correctionFrom(farmer), national_id: ' ' })).toEqual({});
    expect(patchDiff(farmer, { ...correctionFrom(farmer), national_id: 'AB123' })).toEqual({
      national_id: 'AB123',
    });
  });
});

describe('rejectionOf', () => {
  it('prefers the row’s own rejection and falls back to the last rejected event', () => {
    expect(
      rejectionOf(
        { ...farmer, rejection: { reason_code: 'incomplete', note: null, decided_at: null } },
        [],
      ),
    ).toEqual({ reason_code: 'incomplete', note: null, decided_at: null });
    expect(
      rejectionOf(farmer, [
        { decision: 'rejected', reason: 'old', decided_at: '2026-01-01' },
        { decision: 'rejected', reason: 'new', decided_at: '2026-02-01' },
        { decision: 'verified', reason: null, decided_at: '2026-03-01' },
      ] as never),
    ).toEqual({ reason_code: null, note: 'new', decided_at: '2026-02-01' });
    expect(rejectionOf(farmer, null)).toBeNull();
  });
});
