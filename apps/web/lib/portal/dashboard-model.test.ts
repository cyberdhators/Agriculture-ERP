import { describe, expect, it } from 'vitest';

import type { Breakdown, Summary } from '@/lib/reports/api';

import {
  UNAVAILABLE_METRICS,
  ageBandRows,
  breakdownRows,
  donutSegments,
  donutSummaryText,
  registerIsEmpty,
  sexRows,
} from './dashboard-model';

const farmers = (
  verified: number,
  pending: number,
  rejected: number,
  merged: number,
): Summary['farmers'] => ({ verified, pending, rejected, merged });

describe('the donut', () => {
  it('turns four counts into four arcs that together cover the ring', () => {
    const segments = donutSegments(farmers(50, 25, 15, 10));
    expect(segments).not.toBeNull();
    const lengths = segments!.map((s) => Number(s.dash.split(' ')[0]));
    expect(lengths).toEqual([50, 25, 15, 10]);
    expect(lengths.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('starts each arc where the last one ended', () => {
    const segments = donutSegments(farmers(50, 25, 15, 10))!;
    expect(segments.map((s) => s.offset)).toEqual([-0, -50, -75, -90]);
  });

  it('reports percentages of the whole register, not of verified', () => {
    const segments = donutSegments(farmers(50, 25, 15, 10))!;
    expect(segments.map((s) => s.percent)).toEqual([50, 25, 15, 10]);
  });

  it('refuses to draw a ring when nothing has been registered', () => {
    // Four zero-length arcs render as a grey circle that looks like a chart
    // and carries no information. The caller shows an empty state instead.
    expect(donutSegments(farmers(0, 0, 0, 0))).toBeNull();
  });

  it('still draws when only one status has any records', () => {
    const segments = donutSegments(farmers(7, 0, 0, 0))!;
    expect(segments[0]?.percent).toBe(100);
    expect(segments[1]?.value).toBe(0);
  });

  it('describes itself in words for a reader who cannot see it', () => {
    const text = donutSummaryText(donutSegments(farmers(50, 25, 15, 10))!);
    expect(text).toContain('100 records');
    expect(text).toContain('Verified 50 (50%)');
    expect(text).toContain('Merged 10 (10%)');
  });
});

describe('breakdown rows', () => {
  const rows: Breakdown[] = [
    { key: 'EE', verified: 4, reached: 2 },
    { key: 'CE', verified: 9, reached: 5 },
    { key: 'WE', verified: 4, reached: 0 },
  ];

  it('names a key when a name is known and keeps the key when it is not', () => {
    const out = breakdownRows(rows, (k) => (k === 'CE' ? 'Central Equatoria' : undefined));
    expect(out[0]).toEqual({ key: 'CE', label: 'Central Equatoria', value: 9 });
    expect(out.map((r) => r.label)).toContain('EE');
  });

  it('orders by count, and breaks a tie by name rather than arbitrarily', () => {
    const out = breakdownRows(rows, () => undefined);
    expect(out.map((r) => r.key)).toEqual(['CE', 'EE', 'WE']);
  });

  it('counts verified only — reach is a different question', () => {
    const out = breakdownRows(rows, () => undefined);
    expect(out.find((r) => r.key === 'WE')?.value).toBe(4);
  });

  it('can be capped without reordering what survives', () => {
    expect(breakdownRows(rows, () => undefined, 2).map((r) => r.key)).toEqual(['CE', 'EE']);
  });
});

describe('age bands', () => {
  it('shows every band in order, including the ones with nobody in them', () => {
    const out = ageBandRows([{ key: '25_34', verified: 12, reached: 3 }]);
    expect(out.map((r) => r.key)).toEqual(['under_18', '18_24', '25_34', '35_49', '50_plus']);
    expect(out.find((r) => r.key === '25_34')?.value).toBe(12);
    expect(out.find((r) => r.key === 'under_18')?.value).toBe(0);
  });

  it('labels a band as a range and never as an exact age', () => {
    const labels = ageBandRows([]).map((r) => r.label);
    expect(labels).toEqual(['Under 18', '18 to 24', '25 to 34', '35 to 49', '50 and over']);
    for (const label of labels) expect(label).not.toMatch(/exact|years old/i);
  });
});

describe('sex rows', () => {
  it('spells the codes out', () => {
    const out = sexRows([
      { key: 'm', verified: 40, reached: 10 },
      { key: 'f', verified: 60, reached: 20 },
    ]);
    expect(out.map((r) => r.label)).toEqual(['Men', 'Women']);
  });

  it('passes an unrecognised code through rather than dropping the row', () => {
    const out = sexRows([{ key: 'x', verified: 1, reached: 0 }]);
    expect(out).toHaveLength(1);
    expect(out[0]?.label).toBe('x');
  });
});

describe('empty versus unmeasured', () => {
  it('an all-zero register is empty, which is not the same as unmeasured', () => {
    expect(registerIsEmpty(farmers(0, 0, 0, 0))).toBe(true);
    expect(registerIsEmpty(farmers(0, 1, 0, 0))).toBe(false);
  });

  it('every unavailable metric says what the backend would need', () => {
    expect(UNAVAILABLE_METRICS.length).toBeGreaterThan(0);
    for (const metric of UNAVAILABLE_METRICS) {
      expect(metric.label.length).toBeGreaterThan(0);
      expect(metric.because, `${metric.label} does not say why`).toMatch(
        /summary|paginated|route|aggregated/i,
      );
    }
  });
});
