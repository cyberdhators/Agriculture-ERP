import { describe, expect, it } from 'vitest';

import { accountLabel, formatJubaTime, jubaDayBound } from './access-view';

describe('access log presentation', () => {
  it('shows UTC instants in Juba time (UTC+2)', () => {
    expect(formatJubaTime('2026-10-19T10:05:00Z')).toBe('19 Oct 2026, 12:05');
    expect(formatJubaTime('2026-10-19T23:30:00Z')).toBe('20 Oct 2026, 01:30');
    expect(formatJubaTime(null)).toBe('—');
  });

  it('turns a picked date into the bounds of that day in Juba', () => {
    expect(jubaDayBound('2026-10-19', 'start')).toBe('2026-10-19T00:00:00+02:00');
    expect(jubaDayBound('2026-10-19', 'end')).toBe('2026-10-19T23:59:59.999+02:00');
    expect(jubaDayBound('19/10/2026', 'start')).toBeUndefined();
  });

  it('names staff and officers, never farmers or buyers', () => {
    expect(accountLabel({ actor_kind: 'user', actor_id: 'abc', actor_name: 'Staff One' })).toBe(
      'Staff One',
    );
    expect(
      accountLabel({ actor_kind: 'farmer', actor_id: '0123456789abcdef', actor_name: null }),
    ).toBe('Farmer 01234567');
  });
});
