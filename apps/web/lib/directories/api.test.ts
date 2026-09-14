import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DirectoryEntryRow } from '@/lib/fixtures/p1';

import {
  DirectoryApiError,
  listDirectoryEntries,
  removeDirectoryEntry,
  saveDirectoryEntry,
  toInput,
  toRow,
  type DirectoryEntryApi,
} from './api';

function mockFetchSeq(responses: { status: number; body: unknown }[]) {
  const fn = vi.fn();
  for (const r of responses) {
    fn.mockResolvedValueOnce({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: () => Promise.resolve(r.body),
    });
  }
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

afterEach(() => vi.restoreAllMocks());

const api: DirectoryEntryApi = {
  id: 'd-1',
  entry_type: 'agro_dealer',
  name: 'Juba Seeds',
  description: null,
  services: ['seed'],
  contact_name: null,
  phone: '+211920000001',
  alt_phone: null,
  email: null,
  physical_address: null,
  location: null,
  payam_id: 'CE-JUB-MUN',
  state_id: 'CE',
  provider_class: null,
  last_verified_at: '2026-09-01',
  active: true,
};

describe('toRow / toInput', () => {
  it('fills the audit-only columns with what is true and strips them again for the body', () => {
    const row = toRow(api);
    expect(row.deleted_at).toBeNull();
    expect(row.verified_by).toBeNull();
    expect(row.created_at).toBe('2026-09-01');
    const input = toInput(row) as Record<string, unknown>;
    expect(input).not.toHaveProperty('id');
    expect(input).not.toHaveProperty('created_at');
    expect(input).not.toHaveProperty('deleted_at');
    expect(input['name']).toBe('Juba Seeds');
  });
});

describe('listDirectoryEntries', () => {
  it('follows the cursor to the end and maps every page', async () => {
    const fn = mockFetchSeq([
      { status: 200, body: { data: [api], page: { cursor: 'c1', hasMore: true } } },
      {
        status: 200,
        body: { data: [{ ...api, id: 'd-2' }], page: { cursor: null, hasMore: false } },
      },
    ]);
    const rows = await listDirectoryEntries();
    expect(rows.map((r) => r.id)).toEqual(['d-1', 'd-2']);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(String(fn.mock.calls[1]![0])).toContain('cursor=c1');
  });

  it('throws the API error with its status and code', async () => {
    mockFetchSeq([{ status: 403, body: { error: { code: 'forbidden', message: 'No.' } } }]);
    await expect(listDirectoryEntries()).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    await expect(listDirectoryEntries())
      .rejects.toBeInstanceOf(DirectoryApiError)
      .catch(() => {});
  });
});

describe('saveDirectoryEntry', () => {
  const row: DirectoryEntryRow = { ...toRow(api), id: 'client-generated' };

  it('POSTs a new entry and returns the row the server created', async () => {
    const fn = mockFetchSeq([{ status: 201, body: { data: { ...api, id: 'server-id' } } }]);
    const saved = await saveDirectoryEntry(row, false);
    expect(saved.id).toBe('server-id');
    expect(fn.mock.calls[0]![0]).toBe('/api/directory-entries');
    expect((fn.mock.calls[0]![1] as RequestInit).method).toBe('POST');
    const body = JSON.parse(String((fn.mock.calls[0]![1] as RequestInit).body));
    expect(body).not.toHaveProperty('id');
  });

  it('PATCHes an existing entry by id', async () => {
    const fn = mockFetchSeq([{ status: 200, body: { data: api } }]);
    await saveDirectoryEntry({ ...row, id: 'd-1' }, true);
    expect(fn.mock.calls[0]![0]).toBe('/api/directory-entries/d-1');
    expect((fn.mock.calls[0]![1] as RequestInit).method).toBe('PATCH');
  });
});

describe('removeDirectoryEntry', () => {
  it('DELETEs by id', async () => {
    const fn = mockFetchSeq([{ status: 200, body: { data: null } }]);
    await removeDirectoryEntry('d-1');
    expect(fn.mock.calls[0]![0]).toBe('/api/directory-entries/d-1');
    expect((fn.mock.calls[0]![1] as RequestInit).method).toBe('DELETE');
  });
});
