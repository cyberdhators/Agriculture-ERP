import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReportApiError, createExport, getSummary, listExports } from './api';

const summary = {
  as_of: '2026-09-09',
  period: { from: null, to: '2026-09-09T23:59:59.999Z' },
  season: '2026-main',
  farmers: { verified: 12, pending: 3, rejected: 1, merged: 0 },
  reach: { farmers_reached: 8, visits: 20, other_farmers_visited: 2 },
  land: { farms_mapped: 15, hectares: 42.5, farms_of_verified: 14 },
  by: {
    sex: [{ key: 'f', verified: 7, reached: 5 }],
    age_band: [],
    state: [],
    county: [],
    payam: [],
    crop: [{ key: 'sorghum', verified: 6 }],
  },
  notes: ['Reach counts verified farmers only.'],
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

describe('getSummary', () => {
  it('returns the figures and sends validated filters as query params', async () => {
    const fn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: summary }),
    });
    global.fetch = fn as unknown as typeof fetch;

    const result = await getSummary({ cutoff: '2026-09-01', season: '2026-main', state: 'CE' });

    const url = fn.mock.calls[0]![0] as string;
    expect(url.startsWith('/api/reports/summary?')).toBe(true);
    expect(url).toContain('cutoff=2026-09-01');
    expect(url).toContain('season=2026-main');
    expect(url).toContain('state=CE');
    expect(result.farmers.verified).toBe(12);
    expect(result.by.crop[0]!.key).toBe('sorghum');
  });

  it('calls the bare route when no filters are given', async () => {
    const fn = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: summary }),
    });
    global.fetch = fn as unknown as typeof fetch;
    await getSummary();
    expect(fn.mock.calls[0]![0]).toBe('/api/reports/summary');
  });

  it('rejects a future cut-off before any request (shared schema)', async () => {
    const fn = vi.fn();
    global.fetch = fn as unknown as typeof fetch;
    await expect(getSummary({ cutoff: '2999-01-01' })).rejects.toThrow();
    expect(fn).not.toHaveBeenCalled();
  });

  it('rejects a reversed period before any request', async () => {
    const fn = vi.fn();
    global.fetch = fn as unknown as typeof fetch;
    await expect(
      getSummary({ from: '2026-09-09T00:00:00Z', to: '2026-09-01T00:00:00Z' }),
    ).rejects.toThrow();
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('listExports', () => {
  it('returns the log with paging info', async () => {
    mockFetch(200, {
      data: [{ id: 'e-1', report_type: 'summary', row_count: 21, exported_at: '2026-09-09' }],
      page: { cursor: 'c2', hasMore: true },
    });
    const result = await listExports({ limit: 20 });
    expect(result.exports).toHaveLength(1);
    expect(result.cursor).toBe('c2');
    expect(result.hasMore).toBe(true);
  });
});

describe('createExport', () => {
  it('validates and posts the request, returning the export and its data', async () => {
    const fn = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () =>
        Promise.resolve({
          data: { export: { id: 'e-9', report_type: 'summary', row_count: 21 }, data: summary },
        }),
    });
    global.fetch = fn as unknown as typeof fetch;

    const result = await createExport({ report_type: 'summary', filters: { state: 'CE' } });

    expect(fn.mock.calls[0]![0]).toBe('/api/reports/exports');
    const init = fn.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string).report_type).toBe('summary');
    expect(result.export.id).toBe('e-9');
    expect((result.data as typeof summary).farmers.verified).toBe(12);
  });

  it('rejects an unknown report type before any request', async () => {
    const fn = vi.fn();
    global.fetch = fn as unknown as typeof fetch;
    await expect(createExport({ report_type: 'nonsense' } as never)).rejects.toThrow();
    expect(fn).not.toHaveBeenCalled();
  });

  it('surfaces a server error as a ReportApiError', async () => {
    mockFetch(403, { error: { code: 'forbidden', message: 'read_only cannot export' } });
    await expect(createExport({ report_type: 'summary' })).rejects.toMatchObject({
      name: 'ReportApiError',
      status: 403,
      code: 'forbidden',
    });
    expect(ReportApiError).toBeDefined();
  });
});
