/**
 * MATCH ALERTS (2026-10-26). docs/DECISIONS.md, "Match alerts".
 *
 * When a buying request goes on the market, the people who sell what it asks
 * for are told; when a produce listing goes on the market, the people whose
 * open buying requests it answers are told. A notice in the app (and, only
 * for those who switched it on, an SMS). It is a MARKETING notice: it has its
 * own switch, a daily cap, and is never sent to the poster themselves, across
 * a block, or to a suspended account.
 *
 * Pure: the server reads the candidates, this decides who is told.
 */

/** At most this many match alerts to one person in any 24 hours. */
export const MATCH_ALERT_DAILY_CAP = 2;

/** At most this many people are told about one post. */
export const MATCH_ALERT_MAX_RECIPIENTS = 50;

/**
 * The activities (account_profile.activities) that SELL produce. A product on
 * a public profile counts as something the person sells when they state one
 * of these, or state no activity at all.
 */
export const SELLING_ACTIVITIES = ['farmer', 'trader', 'processor', 'input_supplier'] as const;

/** Whether a profile's stated activities make its products offers. */
export const profileSells = (activities: readonly string[]): boolean =>
  activities.length === 0 ||
  activities.some((a) => (SELLING_ACTIVITIES as readonly string[]).includes(a));

/** One post that went on the market. */
export interface MatchPost {
  kind: 'buying_request' | 'listing';
  category: string;
  product_name: string;
  /** The post's state; a match must be in the same state when both are known. */
  state_id: string | null;
  /** The poster's sign-in, never told about their own post. */
  poster_auth_user_id: string | null;
  /**
   * 2026-11-03: the post's price in SSP (a listing's asking price, a request's
   * offered one), for a saved search's highest price. Optional: the activity
   * matching above never reads it.
   */
  price_ssp?: number | null;
}

/** Something a candidate offers or wants: a listing, a request, or a profile product. */
export interface MatchItem {
  category: string | null;
  product_name: string;
  state_id: string | null;
}

/** One person who might be told. */
export interface MatchCandidate {
  auth_user_id: string;
  items: readonly MatchItem[];
  /** Suspended (farmer or buyer side): never told. */
  suspended: boolean;
  /** A block either way between this person and the poster. */
  blocked: boolean;
  /** Their match-alert switch in the app. */
  match_in_app: boolean;
  /** Match alerts already sent to them in the last 24 hours. */
  sent_last_24h: number;
  /** Already told about this very post (a re-save, a pause and resume). */
  already_told: boolean;
}

/** Lower case, letters and digits only, a trailing plural "s" dropped: "Beans " -> "bean". */
export function normaliseProduct(name: string): string[] {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3)
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

const GENERIC = new Set(['fresh', 'white', 'yellow', 'red', 'green', 'dry', 'dried', 'local']);

/**
 * Two product names match when they share a meaningful word: "Sorghum" and
 * "Red sorghum (dry)", "groundnuts" and "Groundnut". Colour and condition
 * words alone are not a match.
 */
export function productsMatch(a: string, b: string): boolean {
  const left = new Set(normaliseProduct(a).filter((w) => !GENERIC.has(w)));
  if (left.size === 0) return false;
  return normaliseProduct(b).some((w) => left.has(w));
}

/** One item answers the post: same product, same category when both are known, same state when both are known. */
export function itemMatches(post: MatchPost, item: MatchItem): boolean {
  if (!productsMatch(post.product_name, item.product_name)) return false;
  if (item.category && post.category && item.category !== post.category) return false;
  if (item.state_id && post.state_id && item.state_id !== post.state_id) return false;
  return true;
}

export type MatchSkip =
  'poster' | 'suspended' | 'blocked' | 'preference' | 'already_told' | 'daily_cap' | 'no_match';

/** The marketing facts about one person, whatever made them a candidate. */
export type MatchFacts = Omit<MatchCandidate, 'items'>;

/**
 * 2026-11-03: the marketing rules alone -- poster, suspension, block, switch,
 * once per post, the daily cap -- shared by the activity matches below and
 * the saved searches (saved-searches.ts), so both obey exactly the same rules.
 */
export function factSkipReason(post: MatchPost, c: MatchFacts): MatchSkip | null {
  if (post.poster_auth_user_id && c.auth_user_id === post.poster_auth_user_id) return 'poster';
  if (c.suspended) return 'suspended';
  if (c.blocked) return 'blocked';
  if (!c.match_in_app) return 'preference';
  if (c.already_told) return 'already_told';
  if (c.sent_last_24h >= MATCH_ALERT_DAILY_CAP) return 'daily_cap';
  return null;
}

/** Why one candidate is not told, or null when they are. */
export function matchSkipReason(post: MatchPost, c: MatchCandidate): MatchSkip | null {
  const facts = factSkipReason(post, c);
  if (facts) return facts;
  if (!c.items.some((item) => itemMatches(post, item))) return 'no_match';
  return null;
}

/** Who is told, each person once, at most MATCH_ALERT_MAX_RECIPIENTS. */
export function selectMatchRecipients(
  post: MatchPost,
  candidates: readonly MatchCandidate[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.auth_user_id)) continue;
    if (matchSkipReason(post, c) !== null) continue;
    seen.add(c.auth_user_id);
    out.push(c.auth_user_id);
    if (out.length >= MATCH_ALERT_MAX_RECIPIENTS) break;
  }
  return out;
}

/** The single SQL-side word filter: the post's meaningful words, for a first ILIKE narrowing. */
export function matchWords(productName: string): string[] {
  return [...new Set(normaliseProduct(productName).filter((w) => !GENERIC.has(w)))].slice(0, 5);
}
