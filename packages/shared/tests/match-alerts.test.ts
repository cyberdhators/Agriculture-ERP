import { describe, expect, it } from 'vitest';

import {
  MATCH_ALERT_DAILY_CAP,
  MATCH_ALERT_MAX_RECIPIENTS,
  matchSkipReason,
  matchWords,
  productsMatch,
  profileSells,
  selectMatchRecipients,
  type MatchCandidate,
  type MatchPost,
} from '../src';

/**
 * Generic fixtures on purpose: matching is driven by data, never by a
 * product, a state or an account named in code.
 */
const POSTER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SELLER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const post = (over: Partial<MatchPost> = {}): MatchPost => ({
  kind: 'buying_request',
  category: 'crop',
  product_name: 'Sorghum',
  state_id: 'ST-1',
  poster_auth_user_id: POSTER,
  ...over,
});

const seller = (over: Partial<MatchCandidate> = {}): MatchCandidate => ({
  auth_user_id: SELLER,
  items: [{ category: 'crop', product_name: 'Red sorghum (dry)', state_id: 'ST-1' }],
  suspended: false,
  blocked: false,
  match_in_app: true,
  sent_last_24h: 0,
  already_told: false,
  ...over,
});

describe('product names', () => {
  it('match on a shared meaningful word, plurals and case aside', () => {
    expect(productsMatch('Groundnuts', 'groundnut')).toBe(true);
    expect(productsMatch('Sorghum', 'Red sorghum (dry)')).toBe(true);
    expect(productsMatch('Cassava flour', 'cassava')).toBe(true);
  });

  it('colour and condition words alone are not a match', () => {
    expect(productsMatch('White beans', 'White sesame')).toBe(false);
    expect(productsMatch('Dry fish', 'Dry okra')).toBe(false);
  });

  it('different products do not match', () => {
    expect(productsMatch('Sorghum', 'Sesame')).toBe(false);
  });

  it('works in Arabic script too', () => {
    expect(productsMatch('ذرة رفيعة', 'ذرة')).toBe(true);
  });

  it('gives the SQL narrowing a few words, never the generic ones', () => {
    expect(matchWords('Fresh white sorghum')).toEqual(['sorghum']);
  });
});

describe('who is told', () => {
  it('a seller of the product in the same state is told', () => {
    expect(matchSkipReason(post(), seller())).toBeNull();
    expect(selectMatchRecipients(post(), [seller()])).toEqual([SELLER]);
  });

  it('never the poster', () => {
    expect(matchSkipReason(post(), seller({ auth_user_id: POSTER }))).toBe('poster');
  });

  it('never a suspended account, never across a block', () => {
    expect(matchSkipReason(post(), seller({ suspended: true }))).toBe('suspended');
    expect(matchSkipReason(post(), seller({ blocked: true }))).toBe('blocked');
  });

  it('respects the match-alert switch', () => {
    expect(matchSkipReason(post(), seller({ match_in_app: false }))).toBe('preference');
  });

  it('caps marketing notices per person per day', () => {
    expect(
      matchSkipReason(post(), seller({ sent_last_24h: MATCH_ALERT_DAILY_CAP - 1 })),
    ).toBeNull();
    expect(matchSkipReason(post(), seller({ sent_last_24h: MATCH_ALERT_DAILY_CAP }))).toBe(
      'daily_cap',
    );
  });

  it('tells a person once per post', () => {
    expect(matchSkipReason(post(), seller({ already_told: true }))).toBe('already_told');
  });

  it('needs the same state when both are known, and the same category', () => {
    expect(
      matchSkipReason(
        post(),
        seller({ items: [{ category: 'crop', product_name: 'Sorghum', state_id: 'ST-2' }] }),
      ),
    ).toBe('no_match');
    expect(
      matchSkipReason(
        post(),
        seller({ items: [{ category: 'processed', product_name: 'Sorghum', state_id: 'ST-1' }] }),
      ),
    ).toBe('no_match');
    // A profile product names no category and maybe no state: it still answers.
    expect(
      matchSkipReason(
        post(),
        seller({ items: [{ category: null, product_name: 'sorghum', state_id: null }] }),
      ),
    ).toBeNull();
  });

  it('works the other way: a listing tells the owners of matching requests', () => {
    const listing = post({ kind: 'listing', poster_auth_user_id: SELLER });
    const buyer = seller({
      auth_user_id: POSTER,
      items: [{ category: 'crop', product_name: 'sorghum', state_id: 'ST-1' }],
    });
    expect(selectMatchRecipients(listing, [buyer])).toEqual([POSTER]);
  });

  it('each person once, and at most the recipient limit', () => {
    const many = Array.from({ length: MATCH_ALERT_MAX_RECIPIENTS + 10 }, (_, i) =>
      seller({ auth_user_id: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000` }),
    );
    expect(selectMatchRecipients(post(), [...many, many[0]!])).toHaveLength(
      MATCH_ALERT_MAX_RECIPIENTS,
    );
  });

  it('a profile sells when it states a selling activity, or none', () => {
    expect(profileSells([])).toBe(true);
    expect(profileSells(['trader'])).toBe(true);
    expect(profileSells(['knowledge_provider'])).toBe(false);
  });
});
