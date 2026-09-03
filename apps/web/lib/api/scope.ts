import { type Scope } from '@agri-erp/shared';

import { forbidden } from './errors';
import { type Authenticated } from './require-role';

/**
 * Turning a scope into a SQL condition, in one place.
 *
 * Every list and every single-record read uses this. A route that writes its own
 * WHERE clause is how an officer in Yei reads a farmer in Juba: the query works,
 * the JSON is well formed, the status is 200, and nothing is red.
 */

export interface ScopeCondition {
  /** SQL fragment with $N placeholders, or null when the caller may see everything. */
  readonly sql: string | null;
  readonly params: readonly unknown[];
}

/**
 * Restricts a query by the caller's scope.
 *
 * `stateColumn` is the column holding the row's state. Passing null for
 * `officerColumn` means the table has no owning officer, so an officer can see
 * none of it -- which is deliberate: an officer's caseload is what they
 * registered, and a table with no registrar is not their caseload.
 */
export function scopeCondition(
  scope: Scope,
  stateColumn: string,
  officerColumn: string | null,
  firstParam: number,
): ScopeCondition {
  if (scope.kind === 'all') return { sql: null, params: [] };

  if (scope.kind === 'state') {
    return { sql: `${stateColumn} = $${firstParam}`, params: [scope.stateId] };
  }

  // caseload. An officer sees the records THEY registered -- not other
  // officers' records in the same payam. C-3.4 and the note in C-3.
  if (!officerColumn) {
    // Nothing on this table belongs to an officer, so an officer sees nothing.
    // `false` rather than an empty result by accident.
    return { sql: 'false', params: [] };
  }
  return { sql: `${officerColumn} = $${firstParam}::uuid`, params: [scope.officerId] };
}

/**
 * Refuses a write to a role that may not write. C-3.9.
 *
 * read_only reaches routes it may read, so the check cannot live only in the
 * role list of a write route -- it lives here, and every write calls it.
 */
export function requireWriter(auth: Authenticated): void {
  if (auth.role === 'read_only') throw forbidden();
}
