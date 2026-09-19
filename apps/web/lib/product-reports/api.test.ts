import { afterEach, describe, expect, it, vi } from 'vitest';

import { ServiceNotConnectedError } from '@/lib/communications/api';

import { getUnreadReportCount, listProductReports } from './api';
import { reasonLabel, statusLabel, statusTone } from '@/components/product-reports/presentation';

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

describe('nothing is invented while the service is absent', () => {
  it('a missing list route is an explicit not-connected error, not an empty list', async () => {
    // An empty list would say "no listing has been reported". The truth is
    // that nobody has looked, because there is nothing to look at yet.
    mockFetch(404, {});
    await expect(listProductReports()).rejects.toBeInstanceOf(ServiceNotConnectedError);
  });

  it('a missing unread-count route never yields a number', async () => {
    // Especially not zero: a badge is a figure, and this system does not print
    // a figure it cannot source.
    mockFetch(404, {});
    await expect(getUnreadReportCount()).rejects.toBeInstanceOf(ServiceNotConnectedError);
  });

  it('reads the page, cursor and hasMore when the route does exist', async () => {
    mockFetch(200, {
      data: [{ id: 'r1', listing_id: 'l1', reason: 'other', status: 'new' }],
      page: { cursor: 'next', hasMore: true },
    });
    const page = await listProductReports();
    expect(page.reports).toHaveLength(1);
    expect(page.cursor).toBe('next');
    expect(page.hasMore).toBe(true);
  });

  it('sends only the filters the contract defines', async () => {
    const fn = mockFetch(200, { data: [] });
    await listProductReports({ status: 'new', cursor: 'c1' });
    const url = String(fn.mock.calls[0]![0]);
    expect(url).toContain('status=new');
    expect(url).toContain('cursor=c1');
    for (const invented of ['q=', 'search=', 'vendor=', 'reporter=']) {
      expect(url, `sent an unsupported ${invented} filter`).not.toContain(invented);
    }
  });

  it('carries the unread count through when the route serves one', async () => {
    mockFetch(200, { data: { unread: 3 } });
    expect((await getUnreadReportCount()).unread).toBe(3);
  });
});

describe('labels survive a vocabulary this build has not seen', () => {
  it('names the proposed reasons and statuses', () => {
    expect(reasonLabel('counterfeit_or_fraud')).toBe('Counterfeit or fraud');
    expect(statusLabel('reviewing')).toBe('Reviewing');
  });

  it('falls back rather than hiding a report', () => {
    // The backend owns these vocabularies once it exists. A status this build
    // has never heard of must still appear in the queue.
    expect(reasonLabel('price_gouging')).toBe('price gouging');
    expect(statusLabel('escalated')).toBe('escalated');
  });

  it('never conveys status by colour alone', () => {
    for (const status of ['new', 'reviewing', 'resolved', 'dismissed', 'unheard_of']) {
      expect(statusLabel(status).length).toBeGreaterThan(0);
      expect(typeof statusTone(status)).toBe('string');
    }
  });
});

describe('the reporter is not identified', () => {
  it('the client surfaces no reporter contact field', async () => {
    // A marketplace visitor holds no account, so anything identifying would
    // make the reporter personal data too. The contract carries nothing until
    // the owner decides what, if anything, is stored.
    mockFetch(200, { data: [{ id: 'r1', listing_id: 'l1', reason: 'other', status: 'new' }] });
    const page = await listProductReports();
    const row = page.reports[0] as unknown as Record<string, unknown>;
    for (const field of ['reporter_name', 'reporter_phone', 'reporter_email', 'reporter_ip']) {
      expect(row[field], `the client surfaced ${field}`).toBeUndefined();
    }
  });
});
