import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AdminApiError,
  createOfficer,
  deactivateStaff,
  listOfficers,
  listStaff,
  setOfficerActive,
} from './api';

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

describe('listStaff / listOfficers', () => {
  it('returns the data array, empty when absent', async () => {
    mockFetch(200, { data: [{ id: 'u-1', name: 'A', role: 'admin', state_id: null }] });
    expect(await listStaff()).toHaveLength(1);
    mockFetch(200, {});
    expect(await listOfficers()).toEqual([]);
  });
});

describe('createOfficer', () => {
  it('POSTs to /api/officers and returns the created officer', async () => {
    const fn = mockFetch(201, { data: { id: 'o-9', name: 'New', status: 'active' } });
    const officer = await createOfficer({ name: 'New' } as never);
    expect(officer.id).toBe('o-9');
    expect(fn.mock.calls[0]![0]).toBe('/api/officers');
    expect((fn.mock.calls[0]![1] as RequestInit).method).toBe('POST');
  });
});

describe('setOfficerActive', () => {
  it('PATCHes the status to inactive when deactivating', async () => {
    const fn = mockFetch(200, { data: { id: 'o-3', status: 'inactive' } });
    await setOfficerActive('o-3', false);
    const init = fn.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ status: 'inactive' });
  });
});

describe('deactivateStaff', () => {
  it('DELETEs the staff account (soft delete)', async () => {
    const fn = mockFetch(200, { data: { ok: true } });
    await deactivateStaff('u-2');
    expect(fn.mock.calls[0]![0]).toBe('/api/users/u-2');
    expect((fn.mock.calls[0]![1] as RequestInit).method).toBe('DELETE');
  });
});

describe('error handling', () => {
  it('throws AdminApiError with status, code and rule', async () => {
    mockFetch(422, {
      error: { code: 'unprocessable', message: 'Bad', rule: 'state_required_for_role' },
    });
    await expect(listStaff()).rejects.toMatchObject({
      name: 'AdminApiError',
      status: 422,
      code: 'unprocessable',
      rule: 'state_required_for_role',
    });
    expect(AdminApiError).toBeDefined();
  });
});
