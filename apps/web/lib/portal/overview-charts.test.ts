import { describe, expect, it } from 'vitest';

import { overviewQuery } from './admin-overview-api';
import { barRects, ceilingOf, linePath, total } from './overview-charts';

const BOX = { width: 100, height: 50, pad: 10 };

describe('the overview charts', () => {
  it('never divides by zero: an all-zero series has a ceiling of 1 and flat marks', () => {
    expect(ceilingOf([0, 0], [])).toBe(1);
    expect(barRects([0, 0], BOX).every((r) => r.height === 0 && r.y === 50)).toBe(true);
  });

  it('scales the tallest bar to the box less its top padding', () => {
    const rects = barRects([1, 4], BOX);
    expect(rects).toHaveLength(2);
    expect(rects[1]).toMatchObject({ height: 40, y: 10 });
    expect(rects[0]).toMatchObject({ height: 10, y: 40 });
    expect(rects[1]!.x).toBeGreaterThan(rects[0]!.x);
  });

  it('draws a line through evenly spaced points on a shared ceiling', () => {
    expect(linePath([0, 2, 4], BOX, 4)).toBe('M0 50 L50 30 L100 10');
    expect(linePath([3], BOX, 3)).toBe('M0 10 L100 10');
    expect(linePath([], BOX)).toBe('');
  });

  it('adds a series up', () => {
    expect(total([1, 2, 3])).toBe(6);
  });
});

describe('the overview query string', () => {
  it('carries only the filters that are set, in a stable order', () => {
    expect(overviewQuery({})).toBe('');
    expect(overviewQuery({ actor: 'farmer', from: '2026-10-01', state_id: 'CE' })).toBe(
      'from=2026-10-01&state_id=CE&actor=farmer',
    );
  });
});
