import { describe, expect, it } from 'vitest';

import { SHORTCUTS, SHORTCUT_HREF, orderShortcuts } from './shortcuts';

describe('the shortcut hub orders tiles by chosen activities and never hides one', () => {
  it('keeps the default order when nothing is chosen', () => {
    expect(orderShortcuts([])).toEqual([...SHORTCUTS]);
    expect(orderShortcuts(null)).toEqual([...SHORTCUTS]);
  });

  it('puts buying first for a buyer, and still shows every tile', () => {
    const order = orderShortcuts(['buyer']);
    expect(order.slice(0, 2)).toEqual(['buy', 'buying_request']);
    expect([...order].sort()).toEqual([...SHORTCUTS].sort());
  });

  it('puts services first for a transporter', () => {
    expect(orderShortcuts(['transport'])[0]).toBe('services');
  });

  it('puts selling first for a farmer and ignores unknown activities', () => {
    const order = orderShortcuts(['farmer', 'astronaut']);
    expect(order[0]).toBe('sell');
    expect(order).toHaveLength(SHORTCUTS.length);
  });

  it('gives every tile an address in both shells', () => {
    for (const shell of ['farmer', 'buyer'] as const) {
      for (const s of SHORTCUTS) expect(SHORTCUT_HREF[shell][s]).toMatch(/^\//);
    }
  });
});
