import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LibraryApiError,
  listLearningResources,
  removeLearningResource,
  saveLearningResource,
  toInput,
  transitionLearningResource,
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
  status: 'published',
  topics: ['crops'],
  title_ar: 'تباعد الذرة الرفيعة',
  description_ar: null,
  submitted_at: null,
  submitted_by_name: null,
  reviewed_at: null,
  reviewed_by_name: null,
  review_note: null,
  published_at: null,
  published_by_name: null,
};

describe('toRow / toInput', () => {
  it('adds the columns the route does not carry and strips them for the body', () => {
    const row = toRow(api);
    expect(row.deleted_at).toBeNull();
    expect(row.uploaded_by).toBeNull();
    const input = toInput(row) as Record<string, unknown>;
    expect(input).not.toHaveProperty('id');
    expect(input).not.toHaveProperty('uploaded_at');
    // 2026-10-22: going public is the publish move, never a field of the card.
    expect(input).not.toHaveProperty('published');
    expect(input).not.toHaveProperty('status');
    expect(input['topics']).toEqual(['crops']);
    expect(input['title_ar']).toBe('تباعد الذرة الرفيعة');
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
  it('POSTs a new resource; PATCHes an existing one', async () => {
    const fn = mockFetchSeq([
      { status: 201, body: { data: { ...api, id: 'server-id' } } },
      { status: 200, body: { data: { ...api, title: 'Sorghum row spacing' } } },
    ]);
    const created = await saveLearningResource({ ...toRow(api), id: 'tmp' }, false);
    expect(created.id).toBe('server-id');
    expect((fn.mock.calls[0]![1] as RequestInit).method).toBe('POST');
    const edited = await saveLearningResource(
      { ...toRow(api), title: 'Sorghum row spacing' },
      true,
    );
    expect(edited.title).toBe('Sorghum row spacing');
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

describe('transitionLearningResource (2026-10-22)', () => {
  it('POSTs the move to the transition route, with the note only when given', async () => {
    const fn = mockFetchSeq([
      { status: 200, body: { data: { ...api, status: 'in_review', published: false } } },
      { status: 200, body: { data: { ...api, status: 'draft', review_note: 'Add the Arabic.' } } },
    ]);
    const submitted = await transitionLearningResource('r-1', 'submit');
    expect(submitted.status).toBe('in_review');
    expect(fn.mock.calls[0]![0]).toBe('/api/learning-resources/r-1/transition');
    expect(JSON.parse((fn.mock.calls[0]![1] as RequestInit).body as string)).toEqual({
      action: 'submit',
    });
    const returned = await transitionLearningResource('r-1', 'return', 'Add the Arabic.');
    expect(returned.review_note).toBe('Add the Arabic.');
    expect(JSON.parse((fn.mock.calls[1]![1] as RequestInit).body as string)).toEqual({
      action: 'return',
      note: 'Add the Arabic.',
    });
  });

  it('surfaces a refused move as its status and code', async () => {
    mockFetchSeq([
      {
        status: 422,
        body: {
          error: {
            code: 'unprocessable',
            message: 'That decision is not available for this record in its current state.',
          },
        },
      },
    ]);
    await expect(transitionLearningResource('r-1', 'publish')).rejects.toMatchObject({
      status: 422,
      code: 'unprocessable',
    });
  });
});
