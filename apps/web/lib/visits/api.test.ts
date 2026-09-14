import { afterEach, describe, expect, it, vi } from 'vitest';

import { createVisit, getVisit, listVisits, VisitApiError, type Visit } from './api';

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

const rawVisit = {
  id: 'f0000000-0000-4000-8000-000000000001',
  farmer_id: 'd0000000-0000-4000-8000-000000000001',
  officer_id: 'a0000000-0000-4000-8000-000000000003',
  payam_id: 'CE-JUB-MUN',
  county_id: 'CE-JUB',
  state_id: 'CE',
  visited_at: '2026-09-05T08:15:00Z',
  received_at: '2026-09-05T08:26:00Z',
  observation: null,
  advice: 'Thin the stand and weed before flowering.',
  topics: ['weeding'],
  duration_minutes: 45,
  attendee_count: 3,
  follow_up_of: null,
  created_at: '2026-09-05T08:26:00Z',
  updated_at: '2026-09-05T08:26:00Z',
};

afterEach(() => vi.restoreAllMocks());

describe('listVisits', () => {
  it('maps the data array and page, defaulting missing attachments to []', async () => {
    mockFetch(200, { data: [rawVisit], page: { cursor: 'c1', hasMore: true } });
    const page = await listVisits();
    expect(page.visits).toHaveLength(1);
    expect(page.visits[0]!.attachments).toEqual([]);
    expect(page.visits[0]!.topics).toEqual(['weeding']);
    expect(page.cursor).toBe('c1');
    expect(page.hasMore).toBe(true);
  });

  it('returns an empty page when data is absent', async () => {
    mockFetch(200, {});
    const page = await listVisits();
    expect(page.visits).toEqual([]);
    expect(page.cursor).toBeNull();
    expect(page.hasMore).toBe(false);
  });

  it('carries the filters into the query string', async () => {
    const fn = mockFetch(200, { data: [] });
    await listVisits({ payam: 'CE-JUB-MUN', limit: 10 });
    const url = fn.mock.calls[0]![0] as string;
    expect(url).toContain('/api/visits?');
    expect(url).toContain('payam=CE-JUB-MUN');
    expect(url).toContain('limit=10');
  });
});

describe('getVisit', () => {
  it('maps attachments and their status onto the view type', async () => {
    mockFetch(200, {
      data: {
        ...rawVisit,
        attachments: [
          {
            id: 'fa000000-0000-4000-8000-000000000001',
            visit_id: rawVisit.id,
            kind: 'photo',
            status: 'arrived',
            message: 'Received.',
            content_type: 'image/jpeg',
            byte_size: 2_400_000,
            captured_at: '2026-09-05T08:20:00Z',
            declared_at: '2026-09-05T08:22:00Z',
            arrived_at: '2026-09-05T08:25:00Z',
            failed_at: null,
            failure_code: null,
          },
        ],
      },
    });
    const visit = await getVisit(rawVisit.id);
    expect(visit.attachments).toHaveLength(1);
    expect(visit.attachments[0]!.status).toBe('arrived');
    expect(visit.attachments[0]!.message).toBe('Received.');
  });
});

describe('createVisit', () => {
  it('POSTs the body to /api/farmers/:id/visits and returns the created visit', async () => {
    const fn = mockFetch(201, { data: rawVisit });
    const created: Visit = await createVisit('d0000000-0000-4000-8000-000000000001', {
      id: rawVisit.id,
      visited_at: rawVisit.visited_at,
      position: { type: 'Point', coordinates: [31.58, 4.85] },
      gps_accuracy_m: 8,
      advice: rawVisit.advice,
      topics: ['weeding'],
    } as never);
    expect(created.id).toBe(rawVisit.id);
    expect(fn.mock.calls[0]![0]).toBe('/api/farmers/d0000000-0000-4000-8000-000000000001/visits');
    const init = fn.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string).advice).toBe(rawVisit.advice);
  });
});

describe('error handling', () => {
  it('throws VisitApiError carrying status, code and rule', async () => {
    mockFetch(422, {
      error: { code: 'unprocessable', message: 'Bad', rule: 'follow_up_not_found' },
    });
    await expect(listVisits()).rejects.toMatchObject({
      name: 'VisitApiError',
      status: 422,
      code: 'unprocessable',
      rule: 'follow_up_not_found',
    });
    expect(VisitApiError).toBeDefined();
  });

  it('falls back to a generic message when the error body is empty', async () => {
    mockFetch(500, {});
    await expect(getVisit('x')).rejects.toMatchObject({
      status: 500,
      code: 'unknown',
    });
  });
});
