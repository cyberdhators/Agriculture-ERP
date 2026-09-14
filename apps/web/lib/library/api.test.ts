import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LibraryApiError,
  listLearningResources,
  removeLearningResource,
  saveLearningResource,
  toInput,
  toRow,
  type LearningResourceApi,
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

const api: LearningResourceApi = {
  id: 'r-1',
  title: 'Sorghum spacing',
  topic: 'crop_production',
  crop: 'sorghum',
  language: 'en',
  format: 'pdf',
  storage_path: 'pdf/2026/sorghum-spacing.pdf',
  byte_size: 120000,
  description: null,
  published: true,
  uploaded_at: '2026-09-01T00:00:00.000Z',
};

describe('toRow / toInput', () => {
  it('adds the columns the route does not carry and strips them for the body', () => {
    const row = toRow(api);
    expect(row.deleted_at).toBeNull();
    expect(row.uploaded_by).toBeNull();
    const input = toInput(row) as Record<string, unknown>;
    expect(input).not.toHaveProperty('id');
    expect(input).not.toHaveProperty('uploaded_at');
    expect(input['published']).toBe(true);
  });
});

describe('listLearningResources', () => {
  it('follows the cursor and maps every page', async () => {
    const fn = mockFetchSeq([
      { status: 200, body: { data: [api], page: { cursor: 'c1', hasMore: true } } },
      {
        status: 200,
        body: { data: [{ ...api, id: 'r-2' }], page: { cursor: null, hasMore: false } },
      },
    ]);
    expect((await listLearningResources()).map((r) => r.id)).toEqual(['r-1', 'r-2']);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws the API error with status and code', async () => {
    mockFetchSeq([
      { status: 401, body: { error: { code: 'unauthenticated', message: 'Sign in.' } } },
    ]);
    const err = await listLearningResources().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LibraryApiError);
    expect(err).toMatchObject({ status: 401, code: 'unauthenticated' });
  });
});

describe('saveLearningResource', () => {
  it('POSTs a new resource; PATCHes an existing one; a publish flip is a PATCH', async () => {
    const fn = mockFetchSeq([
      { status: 201, body: { data: { ...api, id: 'server-id' } } },
      { status: 200, body: { data: { ...api, published: false } } },
    ]);
    const created = await saveLearningResource({ ...toRow(api), id: 'tmp' }, false);
    expect(created.id).toBe('server-id');
    expect((fn.mock.calls[0]![1] as RequestInit).method).toBe('POST');
    const flipped = await saveLearningResource({ ...toRow(api), published: false }, true);
    expect(flipped.published).toBe(false);
    expect(fn.mock.calls[1]![0]).toBe('/api/learning-resources/r-1');
    expect((fn.mock.calls[1]![1] as RequestInit).method).toBe('PATCH');
  });

  it('surfaces the duplicate-file conflict as its code', async () => {
    mockFetchSeq([
      {
        status: 409,
        body: {
          error: {
            code: 'resource_file_already_registered',
            message: 'That file is already a resource.',
          },
        },
      },
    ]);
    await expect(saveLearningResource(toRow(api), false)).rejects.toMatchObject({
      status: 409,
      code: 'resource_file_already_registered',
    });
  });
});

describe('removeLearningResource', () => {
  it('DELETEs by id', async () => {
    const fn = mockFetchSeq([{ status: 200, body: { data: null } }]);
    await removeLearningResource('r-1');
    expect(fn.mock.calls[0]![0]).toBe('/api/learning-resources/r-1');
    expect((fn.mock.calls[0]![1] as RequestInit).method).toBe('DELETE');
  });
});
