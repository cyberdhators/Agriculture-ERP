import { z } from 'zod';

import { LISTING_CATEGORIES } from './buyer';
import {
  MATCH_ALERT_MAX_RECIPIENTS,
  factSkipReason,
  matchSkipReason,
  productsMatch,
  type MatchCandidate,
  type MatchFacts,
  type MatchPost,
} from './match-alerts';

/**
 * SAVED SEARCHES (2026-11-03, owner-approved). docs/DECISIONS.md, "Saved
 * searches".
 *
 * Any signed-in account -- phone or email -- keeps up to SAVED_SEARCH_LIMIT
 * searches ("tell me when this product is listed in this state"). When a
 * produce listing or a buying request goes on the market, the people whose
 * live saved search it answers are told through the EXISTING match-alert
 * machinery: the same switch, the same daily cap, never the poster, never
 * across a block, never a suspended account, once per post per person. A
 * person who would already be told by an activity match (match-alerts.ts) is
 * told once, as before; saved searches only ever ADD people.
 *
 * Pure: the server reads the candidates, this decides who is told.
 */

/** At most this many saved searches per account (live ones; deleted ones do not count). */
export const SAVED_SEARCH_LIMIT = 10;

/** What a saved search watches: produce listings, or buying requests. */
export const SAVED_SEARCH_TARGETS = ['listing', 'buying_request'] as const;
export type SavedSearchTarget = (typeof SAVED_SEARCH_TARGETS)[number];

/** The highest price a search may name, in SSP. */
export const SAVED_SEARCH_MAX_PRICE = 1_000_000_000;

export const SAVED_SEARCH_MESSAGES = {
  targetUnknown: 'Choose produce listings or buying requests.',
  productLength: 'A product is 2 to 80 characters.',
  categoryUnknown: 'Choose a category from the list.',
  stateInvalid: 'Choose a state from the list.',
  priceInvalid: 'Enter the highest price as a number above 0.',
  priceListingsOnly: 'A highest price applies to produce listings only.',
  productOrCategory: 'Enter a product or choose a category.',
  pausedInvalid: 'Say whether the search is paused, true or false.',
} as const;

const M = SAVED_SEARCH_MESSAGES;

/** POST /api/account/saved-searches. The same schema checks the form in the app. */
export const savedSearchSchema = z
  .strictObject({
    target: z.enum(SAVED_SEARCH_TARGETS, { error: () => M.targetUnknown }),
    product_name: z
      .string({ error: () => M.productLength })
      .trim()
      .min(2, M.productLength)
      .max(80, M.productLength)
      .optional(),
    category: z.enum(LISTING_CATEGORIES, { error: () => M.categoryUnknown }).optional(),
    state_id: z
      .string({ error: () => M.stateInvalid })
      .trim()
      .regex(/^[A-Za-z0-9_-]{1,32}$/, M.stateInvalid)
      .optional(),
    max_price_ssp: z
      .number({ error: () => M.priceInvalid })
      .positive(M.priceInvalid)
      .max(SAVED_SEARCH_MAX_PRICE, M.priceInvalid)
      .optional(),
  })
  .superRefine((s, ctx) => {
    if (!s.product_name && !s.category) {
      ctx.addIssue({ code: 'custom', message: M.productOrCategory, path: ['product_name'] });
    }
    if (s.max_price_ssp !== undefined && s.target !== 'listing') {
      ctx.addIssue({ code: 'custom', message: M.priceListingsOnly, path: ['max_price_ssp'] });
    }
  });
export type SavedSearchInput = z.infer<typeof savedSearchSchema>;

/** PATCH /api/account/saved-searches/:id -- pause or resume. */
export const savedSearchPatchSchema = z.strictObject({
  paused: z.boolean({ error: () => M.pausedInvalid }),
});
export type SavedSearchPatch = z.infer<typeof savedSearchPatchSchema>;

/** What a search asks for, as stored. Null is "any". */
export interface SavedSearchCriteria {
  target: SavedSearchTarget;
  product_name: string | null;
  category: string | null;
  state_id: string | null;
  max_price_ssp: number | null;
}

/** A saved search as the API answers it: the owner's own, never anyone else's. */
export interface SavedSearch extends SavedSearchCriteria {
  id: string;
  /** The state's name, for the list; null when no state was chosen. */
  state_name: string | null;
  paused: boolean;
  created_at: string;
}

/** The stored criteria a validated input means: absent is null. */
export function savedSearchCriteria(input: SavedSearchInput): SavedSearchCriteria {
  return {
    target: input.target,
    product_name: input.product_name ?? null,
    category: input.category ?? null,
    state_id: input.state_id ?? null,
    max_price_ssp: input.target === 'listing' ? (input.max_price_ssp ?? null) : null,
  };
}

const norm = (s: string | null): string => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Two searches ask for the same thing (a second save of it returns the first). */
export function sameSavedSearch(a: SavedSearchCriteria, b: SavedSearchCriteria): boolean {
  return (
    a.target === b.target &&
    norm(a.product_name) === norm(b.product_name) &&
    (a.category ?? null) === (b.category ?? null) &&
    (a.state_id ?? null) === (b.state_id ?? null) &&
    (a.max_price_ssp ?? null) === (b.max_price_ssp ?? null)
  );
}

/**
 * One search answers one post: the same kind; the product shares a meaningful
 * word (productsMatch, as the activity matches do); the category and the
 * state equal when the search names them; and, for a listing, the asking
 * price at most the search's highest price when it names one (a listing with
 * no price does not answer a search with a highest price).
 */
export function savedSearchMatches(post: MatchPost, search: SavedSearchCriteria): boolean {
  if (search.target !== post.kind) return false;
  if (!search.product_name && !search.category) return false;
  if (search.product_name && !productsMatch(search.product_name, post.product_name)) return false;
  if (search.category && search.category !== post.category) return false;
  if (search.state_id && search.state_id !== post.state_id) return false;
  if (search.max_price_ssp !== null && post.kind === 'listing') {
    const price = post.price_ssp;
    if (price === null || price === undefined || !(Number(price) <= search.max_price_ssp)) {
      return false;
    }
  }
  return true;
}

/** One person with live saved searches, and the same marketing facts as any candidate. */
export interface SavedSearchCandidate extends MatchFacts {
  searches: readonly (SavedSearchCriteria & { id?: string })[];
}

/** Where an alert came from (marketing_notice.source; the report's filter). */
export const MATCH_ALERT_SOURCES = ['buying_request_match', 'listing_match', 'saved_search'] as const;
export type MatchAlertSource = (typeof MATCH_ALERT_SOURCES)[number];

/** The source an activity match of a post of this kind is recorded under. */
export const activitySource = (kind: MatchPost['kind']): MatchAlertSource =>
  kind === 'buying_request' ? 'buying_request_match' : 'listing_match';

export interface AlertRecipient {
  auth_user_id: string;
  source: MatchAlertSource;
  /** For a saved-search alert, the first of the person's searches that matched. */
  saved_search_id?: string;
}

/**
 * Who is told, and why: the activity matches first, exactly as
 * selectMatchRecipients chooses them, then the saved searches. Each person
 * once (a person matched both ways is an activity match, as before saved
 * searches existed), at most MATCH_ALERT_MAX_RECIPIENTS in all.
 */
export function selectAlertRecipients(
  post: MatchPost,
  activity: readonly MatchCandidate[],
  saved: readonly SavedSearchCandidate[],
): AlertRecipient[] {
  const out: AlertRecipient[] = [];
  const seen = new Set<string>();
  const source = activitySource(post.kind);
  for (const c of activity) {
    if (out.length >= MATCH_ALERT_MAX_RECIPIENTS) return out;
    if (seen.has(c.auth_user_id)) continue;
    if (matchSkipReason(post, c) !== null) continue;
    seen.add(c.auth_user_id);
    out.push({ auth_user_id: c.auth_user_id, source });
  }
  for (const c of saved) {
    if (out.length >= MATCH_ALERT_MAX_RECIPIENTS) return out;
    if (seen.has(c.auth_user_id)) continue;
    if (factSkipReason(post, c) !== null) continue;
    const hit = c.searches.find((s) => savedSearchMatches(post, s));
    if (!hit) continue;
    seen.add(c.auth_user_id);
    out.push({
      auth_user_id: c.auth_user_id,
      source: 'saved_search',
      ...(hit.id ? { saved_search_id: hit.id } : {}),
    });
  }
  return out;
}
