import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ACCOUNT_NOTICES } from '../farmer-notices';
import { en } from '../i18n/en';

import {
  POP_LIFETIME_MS,
  POP_MAX,
  dismissPop,
  livePops,
  nextExpiry,
  planNoticePop,
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

describe('which notice pops, and how fast (2026-11-01, live Scene 1 test)', () => {
  const X = '5f1d7c3e-9a4b-4c2d-8e6f-0a1b2c3d4e5f';
  const Y = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

  it('skips a notice about the conversation that is open', () => {
    expect(
      planNoticePop({ notice: 'message_buying_request', ref_kind: 'conversation', ref_id: X }, X),
    ).toEqual({ action: 'skip' });
  });

  it('still pops a notice about another conversation, or with none open', () => {
    const d = { notice: 'message_buying_request', ref_kind: 'conversation', ref_id: X };
    expect(planNoticePop(d, Y).action).toBe('fixed');
    expect(planNoticePop(d, null).action).toBe('fixed');
  });

  it('never skips a post notice whose id happens to equal the open conversation', () => {
    expect(
      planNoticePop({ notice: 'match_listing', ref_kind: 'listing', ref_id: X }, X).action,
    ).toBe('fixed');
  });

  it('draws a fixed notice at once from its name, with the stored title for its link', () => {
    for (const [name, fixed] of Object.entries(ACCOUNT_NOTICES)) {
      expect(planNoticePop({ notice: name }, null)).toEqual({
        action: 'fixed',
        key: fixed.key,
        title: fixed.title,
      });
      // The card's text exists in the person's language.
      expect(en, name).toHaveProperty([`${fixed.key}.title`]);
      expect(en, name).toHaveProperty([`${fixed.key}.body`]);
    }
  });

  it('reads the text by id only for a notice without fixed text', () => {
    expect(planNoticePop({ notice: 'announcement' }, null)).toEqual({ action: 'fetch' });
    expect(planNoticePop({}, null)).toEqual({ action: 'fetch' });
    expect(planNoticePop({ notice: 'toString' }, null)).toEqual({ action: 'fetch' });
  });

  it('the pop plans before any request, and returns on skip', () => {
    const pop = readFileSync(
      fileURLToPath(new URL('../../components/live/LivePop.tsx', import.meta.url)),
      'utf8',
    );
    const plan = pop.indexOf('planNoticePop(d, where.current.openConversation)');
    expect(plan).toBeGreaterThan(-1);
    expect(plan).toBeLessThan(pop.indexOf('readNotice(d.notification_id)'));
    expect(pop).toMatch(/if \(plan\.action === 'skip'\) return;/);
  });
});
