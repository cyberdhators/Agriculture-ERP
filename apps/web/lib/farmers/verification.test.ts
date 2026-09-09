import { afterEach, describe, expect, it, vi } from 'vitest';

import { VerificationApiError, listQueue, rejectFarmer, verifyFarmer } from './verification';

const row = {
  id: 'f-1',
  farmer_number: 'CE-JUB-000101',
  given_name: 'Mary',
  family_name: 'Aluel',
  sex: 'f' as const,
  year_of_birth: 1988,
  phone: '+211921000101',
  payam_id: 'CE-JUB-REJ',
  state_id: 'CE',
  registered_by: 'o-3',
  registration_source: 'officer' as const,
  verification_status: 'pending' as const,
  merged_into: null,
  consent: { id: 'c-1' },
  created_at: '2026-08-01T00:00:00Z',
};

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

afterEach(() => vi.restoreAllMocks());

describe('listQueue', () => {
  it('maps rows and carries the review metadata', async () => {
    mockFetch(200, {
      data: [{ ...row, days_waiting: 9, escalated: true, duplicates: [{ ...row, id: 'f-2' }] }],
    });
    const items = await listQueue({ escalated: 'true' });
    expect(items).toHaveLength(1);
    expect(items[0]!.days_waiting).toBe(9);
    expect(items[0]!.escalated).toBe(true);
    expect(items[0]!.duplicates[0]!.id).toBe('f-2');
    expect(items[0]!.consent_id).toBe('c-1');
    const url = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain('escalated=true');
  });
});

describe('verifyFarmer', () => {
  it('POSTs to the verify route with an empty body', async () => {
    const fn = mockFetch(200, { data: { ...row, verification_status: 'verified' } });
    const f = await verifyFarmer('f-1');
    expect(f.verification_status).toBe('verified');
    expect(fn.mock.calls[0]![0]).toBe('/api/farmers/f-1/verify');
    expect((fn.mock.calls[0]![1] as RequestInit).method).toBe('POST');
  });
});

describe('rejectFarmer', () => {
  it('POSTs the reason code and note to the reject route', async () => {
    const fn = mockFetch(200, { data: { ...row, verification_status: 'rejected' } });
    await rejectFarmer('f-1', { reason_code: 'incomplete', note: 'missing photo' });
    expect(fn.mock.calls[0]![0]).toBe('/api/farmers/f-1/reject');
    expect(JSON.parse((fn.mock.calls[0]![1] as RequestInit).body as string)).toEqual({
      reason_code: 'incomplete',
      note: 'missing photo',
    });
  });
});

describe('errors', () => {
  it('throws VerificationApiError carrying code and rule', async () => {
    mockFetch(422, { error: { code: 'unprocessable', message: 'x', rule: 'invalid_transition' } });
    await expect(verifyFarmer('f-1')).rejects.toMatchObject({
      name: 'VerificationApiError',
      status: 422,
      code: 'unprocessable',
      rule: 'invalid_transition',
    });
    expect(VerificationApiError).toBeDefined();
  });
});
