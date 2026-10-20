import type { Coverage, Scope } from '@agri-erp/shared';

/**
 * WHICH STATES AN ANALYTICS FIGURE MAY COUNT (2026-10-22). Pure, so it is
 * tested without a database.
 *
 * Two limits apply and the narrower wins: the ROLE's scope (a supervisor or
 * read-only user holds one state; an administrator the nation) and how far the
 * caller's `reports.view` PERMISSION reaches (platform, or some states). A
 * requested `state_id` narrows further, and is refused when it lies outside
 * both -- a supervisor cannot read another state's figures by naming it.
 *
 * Returns null for national figures, or the states to limit them to. Throws
 * `refuse()` (the route passes the same 403 requireRole uses) when nothing is
 * left: an empty list must never be read as "no limit".
 */
export function analyticsStates(
  scope: Scope,
  coverage: Coverage,
  requested: string | undefined,
  refuse: () => Error,
): string[] | null {
  let allowed: string[] | null;
  if (scope.kind === 'all') allowed = null;
  else if (scope.kind === 'state') allowed = [scope.stateId];
  else throw refuse();

  if (!coverage.platform) {
    const reach = [...coverage.states];
    allowed = allowed === null ? reach : allowed.filter((s) => coverage.states.has(s));
  }
  if (allowed !== null && allowed.length === 0) throw refuse();

  if (requested !== undefined) {
    if (allowed !== null && !allowed.includes(requested)) throw refuse();
    return [requested];
  }
  return allowed === null ? null : [...allowed].sort();
}
