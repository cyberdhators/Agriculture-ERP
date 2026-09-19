import { afterEach, describe, expect, it, vi } from 'vitest';

import { listFarmGeoJson, removeFarm } from './api';
import { correctVisit, removeVisit } from '../visits/api';

/**
 * THE ADMINISTRATOR'S FIELD-DATA CLIENTS.
 *
 * What these assert is mostly what they REFUSE to do: no fieldwork verb, no
 * invented filter, no permanent deletion, and no correction of the things the
 * field recorded rather than the things a custodian may amend.
 */

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

describe('the map route', () => {
  it('returns the features, the cursor and whether more follow', async () => {
    mockFetch(200, {
      data: [{ type: 'Feature', id: 'b1', geometry: null, properties: {} }],
      page: { cursor: 'next', hasMore: true },
    });
    const page = await listFarmGeoJson();
    expect(page.features).toHaveLength(1);
    expect(page.cursor).toBe('next');
    expect(page.hasMore).toBe(true);
  });

  it('sends only payam, season, cursor and limit', async () => {
    const fn = mockFetch(200, { data: [] });
    await listFarmGeoJson({ payam: 'CE-JUB-MUN', season: '2026-main', limit: 24 });
    const url = String(fn.mock.calls[0]![0]);
    expect(url).toContain('payam=CE-JUB-MUN');
    expect(url).toContain('season=2026-main');
    for (const invented of ['crop', 'officer', 'grade', 'accuracy', 'state', 'county']) {
      expect(url, `sent an unsupported ${invented} filter`).not.toContain(`${invented}=`);
    }
  });

  it('asks for no query when given no filters', async () => {
    const fn = mockFetch(200, { data: [] });
    await listFarmGeoJson();
    expect(fn.mock.calls[0]![0]).toBe('/api/farms/geojson');
  });
});

describe('soft removal', () => {
  it('removes a farm with DELETE and tolerates a bodiless 204', async () => {
    const fn = mockFetch(204, undefined);
    await expect(removeFarm('fm-1')).resolves.toBeUndefined();
    expect(fn.mock.calls[0]![0]).toBe('/api/farms/fm-1');
    expect((fn.mock.calls[0]![1] as RequestInit).method).toBe('DELETE');
  });

  it('removes a visit with DELETE', async () => {
    const fn = mockFetch(204, {});
    await expect(removeVisit('v-1')).resolves.toBeUndefined();
    expect(fn.mock.calls[0]![0]).toBe('/api/visits/v-1');
    expect((fn.mock.calls[0]![1] as RequestInit).method).toBe('DELETE');
  });

  it('carries the server’s refusal rather than claiming success', async () => {
    mockFetch(403, { error: { code: 'forbidden', message: 'Not allowed.' } });
    await expect(removeFarm('fm-1')).rejects.toThrow('Not allowed.');
  });
});

describe('correcting a visit', () => {
  const corrected = {
    id: 'v-1',
    farmer_id: 'f-1',
    officer_id: 'o-1',
    payam_id: 'CE-JUB-MUN',
    county_id: 'CE-JUB',
    state_id: 'CE',
    visited_at: '2026-09-05T08:15:00Z',
    received_at: '2026-09-05T08:26:00Z',
    observation: null,
    advice: 'Corrected advice.',
    topics: ['weeding'],
    duration_minutes: null,
    attendee_count: null,
    follow_up_of: null,
    created_at: '2026-09-05T08:26:00Z',
    updated_at: '2026-09-06T08:26:00Z',
    attachments: [],
  };

  it('PATCHes the visit and returns the stored record', async () => {
    const fn = mockFetch(200, { data: corrected });
    const visit = await correctVisit('v-1', { advice: 'Corrected advice.' });
    expect(visit.advice).toBe('Corrected advice.');
    expect(fn.mock.calls[0]![0]).toBe('/api/visits/v-1');
    expect((fn.mock.calls[0]![1] as RequestInit).method).toBe('PATCH');
  });

  it('refuses a correction that changes what the field recorded', async () => {
    // The shared schema is strict. Position, accuracy, the farmer, the officer
    // and the moment of the visit are not corrections — they are the record of
    // what happened, and an administrator amending the file does not re-record
    // fieldwork. The client validates before any request is sent.
    for (const forbidden of [
      { position: { type: 'Point', coordinates: [31.6, 4.85] } },
      { gps_accuracy_m: 5 },
      { farmer_id: 'someone-else' },
      { officer_id: 'someone-else' },
      { visited_at: '2026-01-01T00:00:00Z' },
    ]) {
      await expect(
        correctVisit('v-1', forbidden as never),
        `${Object.keys(forbidden)[0]} was accepted as a correction`,
      ).rejects.toThrow();
    }
  });

  it('refuses an empty correction rather than sending a no-op', async () => {
    await expect(correctVisit('v-1', {} as never)).rejects.toThrow(/at least one thing/i);
  });

  it('accepts exactly the fields the correction schema defines', async () => {
    mockFetch(200, { data: corrected });
    await expect(
      correctVisit('v-1', {
        advice: 'a',
        observation: 'b',
        topics: ['weeding'],
        duration_minutes: 30,
        attendee_count: 4,
      }),
    ).resolves.toBeDefined();
  });
});
