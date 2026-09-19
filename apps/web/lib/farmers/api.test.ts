import { afterEach, describe, expect, it, vi } from 'vitest';

import { FarmerApiError, createFarmer, getFarmer, listFarmers, toFarmer } from './api';

const row = {
  id: 'f-1',
  farmer_number: 'CE-JUB-000101',
  given_name: 'Mary',
  family_name: 'Aluel',
  sex: 'f' as const,
  year_of_birth: 1988,
  phone: '+211921000101',
  national_id: '99A2211455',
  payam_id: 'CE-JUB-REJ',
  county_id: 'CE-JUB',
  state_id: 'CE',
  registered_by: 'o-3',
  caseload_officer_id: 'o-3',
  registration_source: 'officer' as const,
  verification_status: 'verified' as const,
  merged_into: null,
  duplicate_flag: false,
  consent: { id: 'c-1', text_version: 'v1', language: 'en', granted_at: '2026-07-23T00:00:00Z' },
  created_at: '2026-07-23T00:00:00Z',
  updated_at: '2026-07-23T00:00:00Z',
};

function mockFetch(status: number, body: unknown) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('toFarmer', () => {
  it('maps consent.id to consent_id and keeps the view shape', () => {
    const f = toFarmer(row);
    expect(f.consent_id).toBe('c-1');
    expect(f.farmer_number).toBe('CE-JUB-000101');
    expect(f.caseload_officer_id).toBe('o-3');
    expect(f.national_id).toBe('99A2211455');
    expect(f.verification_status).toBe('verified');
    // county_id and updated_at are not part of the view type. duplicate_flag
    // now is: the route has always returned it and it was simply never mapped.
    expect('county_id' in f).toBe(false);
  });

  it('leaves an absent national_id ABSENT, rather than defaulting it to null', () => {
    // CHANGED, and the change is the point. This used to assert null, which
    // read as "this farmer has no national ID" — a statement the response
    // never made. C-5.8 withholds the field from anyone but an administrator
    // and the farmer's own caseload officer, and withholds it by omitting the
    // key. Defaulting the omission to null destroyed the difference between
    // "you were not told" and "there is none", and the dossier then printed
    // "None recorded" at a supervisor. The key now stays missing so the screen
    // can decline to render the row at all.
    const { national_id: _omit, ...withoutNid } = row;
    void _omit;
    const farmer = toFarmer(withoutNid);
    expect('national_id' in farmer).toBe(false);
    expect(farmer.national_id).toBeUndefined();
  });
});

describe('listFarmers', () => {
  it('maps rows and reads the page cursor', async () => {
    mockFetch(200, { data: [row], page: { cursor: 'next', hasMore: true } });
    const result = await listFarmers({ verification_status: 'verified', payam: 'CE-JUB-REJ' });
    expect(result.farmers).toHaveLength(1);
    expect(result.farmers[0]!.consent_id).toBe('c-1');
    expect(result.cursor).toBe('next');
    expect(result.hasMore).toBe(true);
    const url = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain('verification_status=verified');
    expect(url).toContain('payam=CE-JUB-REJ');
  });
});

describe('createFarmer', () => {
  it('returns the duplicates warning beside the created farmer', async () => {
    mockFetch(201, { data: row, warnings: { duplicates: ['f-9', 'f-8'] } });
    const result = await createFarmer({} as never);
    expect(result.farmer.id).toBe('f-1');
    expect(result.duplicates).toEqual(['f-9', 'f-8']);
  });

  it('defaults duplicates to an empty array when there is no warning', async () => {
    mockFetch(201, { data: row });
    const result = await createFarmer({} as never);
    expect(result.duplicates).toEqual([]);
  });
});

describe('error handling', () => {
  it('throws a FarmerApiError carrying the code and rule', async () => {
    mockFetch(422, { error: { code: 'unprocessable', message: 'Bad', rule: 'consent_required' } });
    await expect(getFarmer('f-1')).rejects.toMatchObject({
      name: 'FarmerApiError',
      status: 422,
      code: 'unprocessable',
      rule: 'consent_required',
    });
    expect(FarmerApiError).toBeDefined();
  });
});
