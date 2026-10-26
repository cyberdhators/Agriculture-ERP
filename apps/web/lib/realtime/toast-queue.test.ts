import { describe, expect, it } from 'vitest';

import {
  POP_LIFETIME_MS,
  POP_MAX,
  dismissPop,
  livePops,
  nextExpiry,
  popIconFor,
  pushPop,
  type Pop,
} from './toast-queue';

const pop = (id: string, at: number, key = id): Pop => ({
  id,
  key,
  icon: 'notice',
  title: 't',
  body: 'b',
  href: '/',
  at,
});

describe('the live pop queue', () => {
  it('shows the newest first and at most three', () => {
    let q: Pop[] = [];
    for (let i = 0; i < 5; i++) q = pushPop(q, pop(`p${i}`, 1000 + i));
    expect(q.map((p) => p.id)).toEqual(['p4', 'p3', 'p2']);
    expect(q).toHaveLength(POP_MAX);
  });

  it('one thing pops once: a second card with the same key is dropped while the first shows', () => {
    let q = pushPop([], pop('notice', 1000, 'conv:1'));
    q = pushPop(q, pop('message', 1500, 'conv:1'));
    expect(q.map((p) => p.id)).toEqual(['notice']);
  });

  it('after the first has gone, the same key may pop again', () => {
    let q = pushPop([], pop('a', 1000, 'conv:1'));
    q = pushPop(q, pop('b', 1000 + POP_LIFETIME_MS + 1, 'conv:1'));
    expect(q.map((p) => p.id)).toEqual(['b']);
  });

  it('cards leave after their lifetime, or when dismissed', () => {
    const q = [pop('a', 1000), pop('b', 3000)];
    expect(livePops(q, 1000 + POP_LIFETIME_MS).map((p) => p.id)).toEqual(['b']);
    expect(dismissPop(q, 'b').map((p) => p.id)).toEqual(['a']);
  });

  it('knows when the next card leaves', () => {
    expect(nextExpiry([], 0)).toBeNull();
    expect(nextExpiry([pop('a', 1000), pop('b', 2000)], 1500)).toBe(POP_LIFETIME_MS - 500);
  });

  it('chooses an icon from the kind and the notice', () => {
    expect(popIconFor('promotional', 'match_buying_request')).toBe('match');
    expect(popIconFor('update', 'message_listing')).toBe('message');
    expect(popIconFor('essential', 'adviser_approved')).toBe('essential');
    expect(popIconFor('update', 'advice_request_updated')).toBe('notice');
  });
});
