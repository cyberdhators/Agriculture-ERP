import { type SavedSearch, type SavedSearchTarget } from '@agri-erp/shared';

import { forbidden } from './errors';
import { type Authenticated } from './require-role';

/**
 * SAVED SEARCHES, THE SERVER SIDE (2026-11-03). docs/DECISIONS.md, "Saved
 * searches". The routes under /api/account/saved-searches read and write the
 * caller's OWN rows only: every statement is keyed by the session's sign-in,
 * never by anything in the body. The matching itself is in
 * lib/api/match-alerts.ts (the existing match-alert run) and
 * shared/src/saved-searches.ts.
 */

/** The session's sign-in: a phone account (farmer) or an email account (buyer). */
export function ownerOf(auth: Authenticated): string {
  if (auth.principal.kind !== 'farmer' && auth.principal.kind !== 'buyer') throw forbidden();
  return auth.principal.authUserId;
}

/** Who acted, for the audit row: the record behind the sign-in, never a name. */
export const searchActor = (auth: Authenticated) => ({
  actorType: auth.principal.kind as 'farmer' | 'buyer',
  actorId: auth.principal.id,
});

/** The columns a saved search is read with; `s` is public.saved_search. */
export const SAVED_SEARCH_COLUMNS = `s.id, s.target, s.product_name, s.category::text AS category,
  s.state_id, st.name AS state_name, s.max_price_ssp::float8 AS max_price_ssp, s.paused_at,
  s.created_at`;

/** FROM and the state join, for SAVED_SEARCH_COLUMNS. */
export const SAVED_SEARCH_FROM = `FROM public.saved_search s
  LEFT JOIN public.state st ON st.id = s.state_id`;

export interface SavedSearchRow {
  id: string;
  target: SavedSearchTarget;
  product_name: string | null;
  category: string | null;
  state_id: string | null;
  state_name: string | null;
  max_price_ssp: number | null;
  paused_at: Date | null;
  created_at: Date;
}

/** The only shape a saved search leaves in. */
export const presentSavedSearch = (row: SavedSearchRow): SavedSearch => ({
  id: row.id,
  target: row.target,
  product_name: row.product_name,
  category: row.category,
  state_id: row.state_id,
  state_name: row.state_name,
  max_price_ssp: row.max_price_ssp === null ? null : Number(row.max_price_ssp),
  paused: row.paused_at !== null,
  created_at: row.created_at.toISOString(),
});

/** What the audit row records of a search: its criteria, never a person. */
export const auditedCriteria = (row: SavedSearchRow | SavedSearch) => ({
  target: row.target,
  product_name: row.product_name,
  category: row.category,
  state_id: row.state_id,
  max_price_ssp: row.max_price_ssp === null ? null : Number(row.max_price_ssp),
});
