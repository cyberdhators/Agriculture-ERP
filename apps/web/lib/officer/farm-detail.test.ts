import { describe, expect, it } from 'vitest';

import { boundaryAsFarm, everMapped, geometryOf, gradeFor, seasonBlocks } from './farm-detail';
import type { FarmBoundaryRecord, FarmRecord } from '@/lib/farms/api';

const RING: [number, number][] = [
  [31.58, 4.85],
  [31.581, 4.85],
  [31.581, 4.851],
  [31.58, 4.851],
  [31.58, 4.85],
];

const boundary = (over: Partial<FarmBoundaryRecord> = {}): FarmBoundaryRecord =>
  ({
    id: 'b1',
    season: '2026-main',
    area_ha: 1.2345,
    grade: 'good',
    point_count: 4,
    mapped_by: 'officer-a',
    mapped_at: '2026-09-20T08:00:00.000Z',
    is_current: true,
    gps_accuracy_m: 6,
    boundary: { type: 'Polygon', coordinates: [RING] },
    centroid: { type: 'Point', coordinates: [31.5805, 4.8505] },
    ...over,
  }) as FarmBoundaryRecord;

const record = (over: Partial<FarmRecord> = {}): FarmRecord =>
  ({
    id: 'farm-1',
    farmer_id: 'farmer-1',
    payam_id: 'CE-JUB-MUN',
    county_id: 'CE-JUB',
    state_id: 'CE',
    season: '2026-main',
    created_by: 'officer-a',
    captured_at: null,
    created_at: '2026-09-20T08:00:00.000Z',
    updated_at: '2026-09-20T08:00:00.000Z',
    boundaries: [boundary()],
    crops: [],
    ...over,
  }) as FarmRecord;

describe('a shape has three states, and they are not two', () => {
  it('SHOWN when the coordinates came with the boundary', () => {
    expect(geometryOf(boundary())).toEqual({ kind: 'shown', ring: RING });
  });

  it('WITHHELD when the boundary exists but its coordinates were not sent (C-7.8)', () => {
    // Another officer walked it; the figures are here, the shape is not.
    const hidden = boundary({
      boundary: undefined,
      centroid: undefined,
      gps_accuracy_m: undefined,
    });
    expect(geometryOf(hidden)).toEqual({ kind: 'withheld' });
  });

  it('NONE when there is no boundary at all', () => {
    expect(geometryOf(null)).toEqual({ kind: 'none' });
    expect(geometryOf(undefined)).toEqual({ kind: 'none' });
  });

  it('WITHHELD IS NOT NONE — the farm was walked, just not by this reader', () => {
    const hidden = boundary({ boundary: undefined });
    expect(geometryOf(hidden).kind).not.toBe('none');
    // And the figures survive, because the route always sends them.
    expect(hidden.area_ha).toBe(1.2345);
    expect(hidden.grade).toBe('good');
  });
});

describe('the grade is the canonical one', () => {
  it('uses the grade the route already computed', () => {
    expect(gradeFor(boundary({ grade: 'poor' }))).toBe('poor');
  });

  it('falls back to the shared function, never to a scale of its own', () => {
    const raw = boundary({ grade: undefined as never, gps_accuracy_m: 12 });
    expect(gradeFor(raw)).toBe('poor');
    const far = boundary({ grade: undefined as never, gps_accuracy_m: 31 });
    expect(gradeFor(far)).toBe('unusable');
  });

  it('an absent accuracy does not become "good"', () => {
    const none = boundary({ grade: undefined as never, gps_accuracy_m: undefined });
    expect(gradeFor(none)).not.toBe('good');
  });
});

describe('seasons group current and superseded apart', () => {
  it('keeps the current boundary and every one it replaced', () => {
    const history = [
      boundary({ id: 'new', is_current: true, mapped_at: '2026-09-20T08:00:00.000Z' }),
      boundary({ id: 'old', is_current: false, mapped_at: '2026-09-10T08:00:00.000Z' }),
      boundary({ id: 'older', is_current: false, mapped_at: '2026-09-01T08:00:00.000Z' }),
    ];
    const [block] = seasonBlocks(record(), history);
    expect(block!.current?.id).toBe('new');
    expect(block!.superseded.map((b) => b.id)).toEqual(['old', 'older']);
  });

  it('one block per season, newest season first', () => {
    const history = [
      boundary({ id: 'a', season: '2026-main' }),
      boundary({ id: 'b', season: '2026-second' }),
      boundary({ id: 'c', season: '2025-main' }),
    ];
    const blocks = seasonBlocks(record(), history);
    expect(blocks.map((b) => b.season)).toEqual(['2026-second', '2026-main', '2025-main']);
  });

  it('a season with crops but no boundary is still a block — it is a real state', () => {
    const blocks = seasonBlocks(record({ crops: [{ season: '2026-second', crop: 'maize' }] }), [
      boundary({ season: '2026-main' }),
    ]);
    const second = blocks.find((b) => b.season === '2026-second')!;
    expect(second.current).toBeNull();
    expect(second.crops).toEqual(['maize']);
  });

  it('crops are matched to their own season, never spread across them', () => {
    const blocks = seasonBlocks(
      record({
        crops: [
          { season: '2026-main', crop: 'sorghum' },
          { season: '2025-main', crop: 'maize' },
        ],
      }),
      [boundary({ season: '2026-main' }), boundary({ id: 'x', season: '2025-main' })],
    );
    expect(blocks.find((b) => b.season === '2026-main')!.crops).toEqual(['sorghum']);
    expect(blocks.find((b) => b.season === '2025-main')!.crops).toEqual(['maize']);
  });

  it('a farm never mapped still reports its own season', () => {
    const blocks = seasonBlocks(record(), []);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.current).toBeNull();
    expect(blocks[0]!.superseded).toEqual([]);
    expect(everMapped([])).toBe(false);
  });
});

describe('the view object handed to the existing SVG', () => {
  it('carries the ring and the server’s own figures', () => {
    const farm = boundaryAsFarm(record(), boundary(), RING);
    expect(farm.boundary).toEqual({ type: 'Polygon', coordinates: [RING] });
    expect(farm.area_ha).toBe(1.2345);
    expect(farm.point_count).toBe(4);
    expect(farm.accuracy_flag).toBe('good');
  });

  it('leaves absent figures ABSENT rather than defaulting them to zero', () => {
    const sparse = boundary({
      area_ha: undefined as never,
      point_count: undefined as never,
      gps_accuracy_m: undefined,
      centroid: undefined,
    });
    const farm = boundaryAsFarm(record(), sparse, RING) as unknown as Record<string, unknown>;
    for (const key of ['area_ha', 'point_count', 'gps_accuracy_m', 'centroid']) {
      expect(key in farm, `${key} was defaulted`).toBe(false);
    }
  });

  it('never computes an area of its own', () => {
    const farm = boundaryAsFarm(record(), boundary({ area_ha: 9.9 }), RING);
    expect(farm.area_ha).toBe(9.9);
  });
});
