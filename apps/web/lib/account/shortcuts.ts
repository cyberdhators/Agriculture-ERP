import { ACTIVITIES, type Activity } from '@agri-erp/shared';

/**
 * THE SHORTCUT HUB (2026-10-28, user journeys; infographic no. 4 "My AgriOne"
 * and the specification, line 49: "Selections personalize shortcuts without
 * restricting these functions").
 *
 * Every account sees EVERY ordinary function: sell, buy, post a buying
 * request, offer services, get advice, its profile and its organisations. The
 * activities the account chose ("who you are, what you do") only ORDER the
 * tiles: a tile that serves more of the chosen activities comes first; ties,
 * and an account that chose nothing, keep the default order. Nothing is ever
 * hidden -- `orderShortcuts` returns the same seven tiles every time.
 */

export const SHORTCUTS = [
  'sell',
  'buy',
  'buying_request',
  'services',
  'advice',
  'profile',
  'organisations',
] as const;
export type Shortcut = (typeof SHORTCUTS)[number];

/** Which chosen activities each tile serves. Profile and organisations serve all equally. */
const SERVES: Record<Shortcut, readonly Activity[]> = {
  sell: ['farmer', 'trader', 'processor', 'input_supplier'],
  buy: ['buyer', 'trader', 'processor'],
  buying_request: ['buyer', 'trader', 'processor'],
  services: [
    'transport',
    'other_services',
    'financial_services',
    'knowledge_provider',
    'processor',
  ],
  advice: ['farmer', 'knowledge_provider'],
  profile: [],
  organisations: [],
};

const known = new Set<string>(ACTIVITIES);

export function orderShortcuts(activities: readonly string[] | null | undefined): Shortcut[] {
  const chosen = new Set((activities ?? []).filter((a) => known.has(a)));
  const score = (s: Shortcut) => SERVES[s].filter((a) => chosen.has(a)).length;
  return SHORTCUTS.map((s, i) => ({ s, i, score: score(s) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.s);
}

/** Where each tile goes, per shell. One account, two front doors (phone / email). */
export const SHORTCUT_HREF: Record<'farmer' | 'buyer', Record<Shortcut, string>> = {
  farmer: {
    sell: '/farmer/account/listings/new',
    buy: '/farmer/account/buy',
    buying_request: '/farmer/account/buying-requests/new',
    services: '/farmer/account/my-services/new',
    advice: '/advice',
    profile: '/farmer/account/public-profile',
    organisations: '/farmer/account/organisations',
  },
  buyer: {
    sell: '/buyer/sell',
    buy: '/buyer/marketplace',
    buying_request: '/buyer/buying-requests/new',
    services: '/buyer/services/new',
    advice: '/advice',
    profile: '/buyer/public-profile',
    organisations: '/buyer/organisations',
  },
};
