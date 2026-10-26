import { describe, expect, it } from 'vitest';

import {
  MATCH_ALERT_DAILY_CAP,
  MATCH_ALERT_MAX_RECIPIENTS,
  SAVED_SEARCH_MESSAGES,
  matchSkipReason,
  sameSavedSearch,
  savedSearchCriteria,
  savedSearchMatches,
  savedSearchPatchSchema,
  savedSearchSchema,
  selectAlertRecipients,
  selectMatchRecipients,
  type MatchCandidate,
  type MatchPost,
  type SavedSearchCandidate,
  type SavedSearchCriteria,
} from '../src';

/**
 * SAVED SEARCHES (2026-11-03). Generic fixtures on purpose: matching is
 * driven by data, never by a product, a state or an account named in code.
 */
const POSTER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SELLER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SAVER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const listing = (over: Partial<MatchPost> = {}): MatchPost => ({
  kind: 'listing',
  category: 'crop',
  product_name: 'Red sorghum (dry)',
  state_id: 'ST-1',
  poster_auth_user_id: POSTER,
  price_ssp: 4000,
  ...over,
});

const search = (over: Partial<SavedSearchCriteria> = {}): SavedSearchCriteria => ({
  target: 'listing',
  product_name: 'Sorghum',
  category: null,
  state_id: null,
  max_price_ssp: null,
  ...over,
});

const facts = {
  suspended: false,
  blocked: false,
  match_in_app: true,
  sent_last_24h: 0,
  already_told: false,
};

const saver = (over: Partial<SavedSearchCandidate> = {}): SavedSearchCandidate => ({
  auth_user_id: SAVER,
  ...facts,
  searches: [search()],
  ...over,
});

const requester = (over: Partial<MatchCandidate> = {}): MatchCandidate => ({
  auth_user_id: SELLER,
  ...facts,
  items: [{ category: 'crop', product_name: 'Sorghum', state_id: 'ST-1' }],
  ...over,
});

describe('the saved-search form schema', () => {
  it('accepts a product, a category, a state and a highest price for listings', () => {
    const parsed = savedSearchSchema.parse({
      target: 'listing',
      product_name: '  Sorghum ',
      category: 'crop',
      state_id: 'ST-1',
      max_price_ssp: 5000,
    });
    expect(parsed.product_name).toBe('Sorghum');
    expect(savedSearchCriteria(parsed)).toEqual({
      target: 'listing',
      product_name: 'Sorghum',
      category: 'crop',
      state_id: 'ST-1',
      max_price_ssp: 5000,
    });
  });

  it('needs a product or a category', () => {
    const r = savedSearchSchema.safeParse({ target: 'listing', state_id: 'ST-1' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe(SAVED_SEARCH_MESSAGES.productOrCategory);
  });

  it('a category alone is enough', () => {
    expect(
      savedSearchSchema.safeParse({ target: 'buying_request', category: 'fruit' }).success,
    ).toBe(true);
  });

  it('refuses a highest price on a buying-request search', () => {
    const r = savedSearchSchema.safeParse({
      target: 'buying_request',
      product_name: 'Sorghum',
      max_price_ssp: 10,
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe(SAVED_SEARCH_MESSAGES.priceListingsOnly);
  });

  it('refuses unknown fields, a short product, an unknown kind and a price of 0', () => {
    expect(
      savedSearchSchema.safeParse({ target: 'listing', product_name: 'ab', extra: 1 }).success,
    ).toBe(false);
    expect(savedSearchSchema.safeParse({ target: 'listing', product_name: 'a' }).success).toBe(
      false,
    );
    expect(
      savedSearchSchema.safeParse({ target: 'service', product_name: 'Sorghum' }).success,
    ).toBe(false);
    expect(
      savedSearchSchema.safeParse({ target: 'listing', product_name: 'Sorghum', max_price_ssp: 0 })
        .success,
    ).toBe(false);
  });

  it('pause takes a boolean only', () => {
    expect(savedSearchPatchSchema.safeParse({ paused: true }).success).toBe(true);
    expect(savedSearchPatchSchema.safeParse({ paused: 'yes' }).success).toBe(false);
  });
});

describe('a saved search answers a post', () => {
  it('by a shared product word, whatever the case and plural', () => {
    expect(savedSearchMatches(listing(), search({ product_name: 'sorghums' }))).toBe(true);
    expect(savedSearchMatches(listing(), search({ product_name: 'Groundnut' }))).toBe(false);
  });

  it('only for its own kind of post', () => {
    expect(savedSearchMatches(listing(), search({ target: 'buying_request' }))).toBe(false);
    expect(
      savedSearchMatches(listing({ kind: 'buying_request' }), search({ target: 'buying_request' })),
    ).toBe(true);
  });

  it('in its state and category when it names them', () => {
    expect(savedSearchMatches(listing(), search({ state_id: 'ST-1' }))).toBe(true);
    expect(savedSearchMatches(listing(), search({ state_id: 'ST-2' }))).toBe(false);
    expect(savedSearchMatches(listing(), search({ category: 'crop' }))).toBe(true);
    expect(savedSearchMatches(listing(), search({ category: 'fruit' }))).toBe(false);
  });

  it('a category-only search answers any product in it', () => {
    expect(savedSearchMatches(listing(), search({ product_name: null, category: 'crop' }))).toBe(
      true,
    );
  });

  it('at or under its highest price; a listing with no price does not answer one', () => {
    expect(savedSearchMatches(listing(), search({ max_price_ssp: 4000 }))).toBe(true);
    expect(savedSearchMatches(listing(), search({ max_price_ssp: 3999 }))).toBe(false);
    expect(savedSearchMatches(listing({ price_ssp: null }), search({ max_price_ssp: 1 }))).toBe(
      false,
    );
  });

  it('colour and condition words alone are not a match', () => {
    expect(savedSearchMatches(listing(), search({ product_name: 'Red dry' }))).toBe(false);
  });
});

describe('who is told: activity matches first, then saved searches, each once', () => {
  it('a saver is told, recorded as a saved-search alert with the search that matched', () => {
    const out = selectAlertRecipients(
      listing(),
      [],
      [saver({ searches: [{ ...search(), id: 'S1' }] })],
    );
    expect(out).toEqual([{ auth_user_id: SAVER, source: 'saved_search', saved_search_id: 'S1' }]);
  });

  it('activity matches are exactly as before, under their own source', () => {
    const post = listing();
    const candidates = [requester()];
    expect(selectAlertRecipients(post, candidates, []).map((r) => r.auth_user_id)).toEqual(
      selectMatchRecipients(post, candidates),
    );
    expect(selectAlertRecipients(post, candidates, [])[0]?.source).toBe('listing_match');
    expect(
      selectAlertRecipients(listing({ kind: 'buying_request' }), candidates, [])[0]?.source,
    ).toBe('buying_request_match');
  });

  it('a person matched both ways is told once, as the activity match', () => {
    const out = selectAlertRecipients(listing(), [requester({ auth_user_id: SAVER })], [saver()]);
    expect(out).toEqual([{ auth_user_id: SAVER, source: 'listing_match' }]);
  });

  it('the marketing rules hold for savers: poster, suspended, blocked, switch, once, cap', () => {
    const post = listing();
    expect(selectAlertRecipients(post, [], [saver({ auth_user_id: POSTER })])).toEqual([]);
    expect(selectAlertRecipients(post, [], [saver({ suspended: true })])).toEqual([]);
    expect(selectAlertRecipients(post, [], [saver({ blocked: true })])).toEqual([]);
    expect(selectAlertRecipients(post, [], [saver({ match_in_app: false })])).toEqual([]);
    expect(selectAlertRecipients(post, [], [saver({ already_told: true })])).toEqual([]);
    expect(
      selectAlertRecipients(post, [], [saver({ sent_last_24h: MATCH_ALERT_DAILY_CAP })]),
    ).toEqual([]);
    expect(
      selectAlertRecipients(post, [], [saver({ sent_last_24h: MATCH_ALERT_DAILY_CAP - 1 })]),
    ).toHaveLength(1);
  });

  it('a saver whose searches do not answer the post is not told', () => {
    expect(
      selectAlertRecipients(listing(), [], [saver({ searches: [search({ state_id: 'ST-9' })] })]),
    ).toEqual([]);
  });

  it('never more than MATCH_ALERT_MAX_RECIPIENTS in all, activity first', () => {
    const many = (prefix: string, n: number) =>
      Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(4, '0')}`);
    const activity = many('a', MATCH_ALERT_MAX_RECIPIENTS - 5).map((id) =>
      requester({ auth_user_id: id }),
    );
    const saved = many('s', 20).map((id) => saver({ auth_user_id: id }));
    const out = selectAlertRecipients(listing(), activity, saved);
    expect(out).toHaveLength(MATCH_ALERT_MAX_RECIPIENTS);
    expect(out.filter((r) => r.source === 'saved_search')).toHaveLength(5);
  });

  it('the activity rules themselves are unchanged (matchSkipReason)', () => {
    expect(matchSkipReason(listing(), requester())).toBeNull();
    expect(matchSkipReason(listing(), requester({ auth_user_id: POSTER }))).toBe('poster');
    expect(matchSkipReason(listing(), requester({ items: [] }))).toBe('no_match');
  });
});

describe('the same search twice', () => {
  it('ignores case and spacing in the product, nothing else', () => {
    expect(sameSavedSearch(search(), search({ product_name: '  sorghum ' }))).toBe(true);
    expect(sameSavedSearch(search(), search({ state_id: 'ST-1' }))).toBe(false);
    expect(sameSavedSearch(search(), search({ max_price_ssp: 10 }))).toBe(false);
    expect(sameSavedSearch(search(), search({ target: 'buying_request' }))).toBe(false);
  });
});
