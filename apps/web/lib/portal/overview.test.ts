import { describe, expect, it } from 'vitest';

import type { QueueItem } from '@/lib/farmers/verification';
import type { Summary } from '@/lib/reports/api';

import { kpisFrom, queueRows } from './overview-pure';

describe('kpisFrom', () => {
  it('counts in-scope as verified + pending + rejected, never merged (C-6.8)', () => {
    const s = { farmers: { verified: 10, pending: 3, rejected: 2, merged: 4 } } as Summary;
    expect(kpisFrom(s)).toEqual({
      in_scope: 15,
      verified: 10,
      pending: 3,
      rejected: 2,
      merged: 4,
    });
    // The point of the criterion: merged is REPORTED beside, never folded in.
    expect(kpisFrom(s).in_scope).toBe(15);
  });
});

describe('queueRows', () => {
  it('puts escalated first, then the longest wait', () => {
    const items = [
      { id: 'a', days_waiting: 2, escalated: false },
      { id: 'b', days_waiting: 9, escalated: true },
      { id: 'c', days_waiting: 5, escalated: false },
      { id: 'd', days_waiting: 8, escalated: true },
    ] as QueueItem[];
    expect(queueRows(items).map((r) => r.id)).toEqual(['b', 'd', 'c', 'a']);
  });
});
