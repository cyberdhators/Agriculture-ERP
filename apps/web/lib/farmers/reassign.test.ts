import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReassignApiError, reassignFarmer } from './reassign';

const OFFICER = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

const farmer = {
  id: 'f-1',
  farmer_number: 'CE-JUB-000101',
  payam_id: 'CE-JUB-REJ',
  registered_by: 'o-3',
  caseload_officer_id: OFFICER,
  verification_status: 'verified',
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

describe('reassignFarmer', () => {
  it('posts { officer_id } to the reassign route and returns the moved farmer', async () => {
    const fn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: farmer }),
    });
    global.fetch = fn as unknown as typeof fetch;

    const result = await reassignFarmer('f-1', OFFICER);

    expect(fn.mock.calls[0]![0]).toBe('/api/farmers/f-1/reassign');
    const init = fn.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ officer_id: OFFICER });
    expect(result.caseload_officer_id).toBe(OFFICER);
    expect(result.registered_by).toBe('o-3');
  });

  it('rejects an officer id that is not a UUID before any request', async () => {
    const fn = vi.fn();
    global.fetch = fn as unknown as typeof fetch;
    await expect(reassignFarmer('f-1', 'not-a-uuid')).rejects.toThrow();
    expect(fn).not.toHaveBeenCalled();
  });

  it('surfaces reassign_same_officer as a ReassignApiError', async () => {
    mockFetch(422, { error: { code: 'reassign_same_officer', message: 'Already theirs' } });
    await expect(reassignFarmer('f-1', OFFICER)).rejects.toMatchObject({
      name: 'ReassignApiError',
      status: 422,
      code: 'reassign_same_officer',
    });
  });

  it('surfaces reassign_officer_not_found as a ReassignApiError', async () => {
    mockFetch(422, { error: { code: 'reassign_officer_not_found', message: 'Not eligible' } });
    await expect(reassignFarmer('f-1', OFFICER)).rejects.toMatchObject({
      name: 'ReassignApiError',
      status: 422,
      code: 'reassign_officer_not_found',
    });
    expect(ReassignApiError).toBeDefined();
  });
});
