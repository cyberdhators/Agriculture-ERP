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
  // CHANGED SHAPE, and the change is the point. These used to return a bare
  // array: the caller got the first page and no cursor, so a national list
  // looked complete when it was twenty-five rows of it. They now return the
  // page, the cursor for the next one, and whether there IS a next one.
  it('returns the page, its cursor and whether more follow', async () => {
    mockFetch(200, {
      data: [{ id: 'u-1', name: 'A', role: 'admin', state_id: null }],
      page: { cursor: 'abc', hasMore: true },
    });
    const page = await listStaff();
    expect(page.rows).toHaveLength(1);
    expect(page.cursor).toBe('abc');
    expect(page.hasMore).toBe(true);
  });

  it('is empty and final when the envelope carries nothing', async () => {
    mockFetch(200, {});
    const page = await listOfficers();
    expect(page.rows).toEqual([]);
    expect(page.cursor).toBeNull();
    expect(page.hasMore).toBe(false);
  });

  it('sends the cursor and limit it was given', async () => {
    const fn = mockFetch(200, { data: [] });
    await listStaff({ cursor: 'c-2', limit: 25 });
    expect(fn.mock.calls[0]![0]).toBe('/api/users?cursor=c-2&limit=25');
  });

  it('asks for no query at all when given no paging', async () => {
    const fn = mockFetch(200, { data: [] });
    await listOfficers();
    expect(fn.mock.calls[0]![0]).toBe('/api/officers');
  });

  it('carries the administrator orphan diagnostic only when the route sent it', async () => {
    // The route computes it for an administrator on the first page alone. A
    // client that defaulted it to 0 would report "no orphaned accounts" to a
    // supervisor who was simply never told.
    mockFetch(200, { data: [], page: { cursor: null, hasMore: false, orphan_auth_accounts: 3 } });
    expect((await listStaff()).orphanAuthAccounts).toBe(3);

    mockFetch(200, { data: [], page: { cursor: null, hasMore: false } });
    const without = await listStaff();
    expect('orphanAuthAccounts' in without).toBe(false);
    expect(without.orphanAuthAccounts).toBeUndefined();
  });
});

describe('setOfficerActive', () => {
  it('surfaces the orphan count the deactivation returned (C-8R.3)', async () => {
    const fn = mockFetch(200, {
      data: { id: 'o-1', name: 'Zz', status: 'inactive', unassigned_farmers: 12 },
    });
    const result = await setOfficerActive('o-1', false);
    expect(result.unassignedFarmers).toBe(12);
    expect(result.officer.status).toBe('inactive');
    // The count is the route's answer, not a field on the officer record.
    expect('unassigned_farmers' in result.officer).toBe(false);
    expect((fn.mock.calls[0]![1] as RequestInit).method).toBe('PATCH');
    expect((fn.mock.calls[0]![1] as RequestInit).body).toBe(JSON.stringify({ status: 'inactive' }));
  });

  it('reports no count on reactivation, because the route sends none', async () => {
    mockFetch(200, { data: { id: 'o-1', name: 'Zz', status: 'active' } });
    const result = await setOfficerActive('o-1', true);
    expect(result.unassignedFarmers).toBeUndefined();
    expect(result.officer.status).toBe('active');
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
