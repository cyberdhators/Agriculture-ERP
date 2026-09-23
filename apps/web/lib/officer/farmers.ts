import { canTransition, type VerificationState } from '@agri-erp/shared';

import type { Farmer } from '@/lib/fixtures/farmers';

/**
 * THE OFFICER'S CASELOAD, AS PURE FUNCTIONS.
 *
 * "My farmers" is not a narrower national directory. It is a different screen
 * answering a different question -- who is mine, and which of them is waiting
 * on me -- so the model is its own rather than the administrator register's
 * with rows removed.
 *
 * SCOPING IS THE SERVER'S AND NOTHING HERE REPEATS IT. `GET /api/farmers`
 * appends `f.caseload_officer_id = $n` for a caseload principal
 * (`lib/api/farmers.ts`, `scopeClause`), so a farmer outside the caseload is
 * not hidden by this code -- it was never in the answer. Nothing below filters
 * for authorisation, and nothing below should ever start: a client-side filter
 * standing in for a WHERE clause is a screen that leaks the moment somebody
 * changes it.
 */

/**
 * The four chips, and the filter each sends. `all` sends none.
 *
 * THERE IS NO "MERGED" CHIP, AND THE TYPES INSIST ON IT. `farmerFilterSchema`
 * accepts `VERIFICATION_STATUSES` -- pending, verified, rejected -- and not the
 * four-value `VERIFICATION_STATES`, because a merged record is not a state you
 * browse for; it is a record that has been folded into another and appears in
 * no count (C-6.8). A merged farmer still renders with a Merged stamp if one
 * reaches the page, but the officer cannot ask for a list of them.
 */
export const STATUS_TABS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'verified', label: 'Verified' },
  { key: 'rejected', label: 'Rejected' },
] as const;

export type StatusTab = (typeof STATUS_TABS)[number]['key'];

export const isStatusTab = (value: string | null): value is StatusTab =>
  value !== null && STATUS_TABS.some((t) => t.key === value);

/**
 * The query `GET /api/farmers` receives for a chip.
 *
 * SERVER-SIDE, ALWAYS. The chip is a filter the route applies, not a predicate
 * this screen runs over a downloaded page -- otherwise "Rejected" would mean
 * "rejected among the first twenty I happen to hold", which is the defect the
 * administrator register was rewritten to remove.
 */
export type FilterableStatus = Exclude<StatusTab, 'all'>;

export function filterFor(tab: StatusTab): { verification_status?: FilterableStatus } {
  return tab === 'all' ? {} : { verification_status: tab };
}

/**
 * Whether this officer may resubmit the record, from the real transition table.
 *
 * `POST /api/farmers/:id/resubmit` is officer-only and runs `transitionFarmer`,
 * which admits `rejected → pending` and nothing else. So the button appears for
 * a rejected record and for no other, and a merged record never -- merging is
 * terminal. Asked of the shared table rather than restated here, so the screen
 * cannot drift from the route.
 */
export function canResubmit(farmer: Pick<Farmer, 'verification_status' | 'merged_into'>): boolean {
  if (farmer.merged_into) return false;
  const from = farmer.verification_status as VerificationState;
  return from === 'rejected' && canTransition(from, 'pending');
}

/**
 * What a card may show, with absence preserved.
 *
 * C-5.8 has three states and this keeps all three: a string, an explicit null,
 * and ABSENT because the route did not send the field. `national_id` reaches
 * the officer who works the farmer and nobody else, so `undefined` here means
 * "you were not told" and must not render as "none recorded".
 */
export interface CardFields {
  readonly name: string;
  readonly farmerNumber: string;
  readonly phone: string | null;
  readonly payamId: string | null;
  /** Absent when the route withheld it; null when the farmer has none. */
  readonly nationalId?: string | null;
  readonly status: VerificationState;
  readonly merged: boolean;
  readonly rejectionReason: string | null;
}

export function cardFields(farmer: Farmer): CardFields {
  const fields: CardFields = {
    name: `${farmer.given_name} ${farmer.family_name}`.trim(),
    farmerNumber: farmer.farmer_number,
    phone: farmer.phone || null,
    payamId: farmer.payam_id || null,
    status: (farmer.merged_into ? 'merged' : farmer.verification_status) as VerificationState,
    merged: Boolean(farmer.merged_into),
    rejectionReason: farmer.rejection?.reason_code ?? null,
  };
  // The key is added only when the route sent one, so the distinction between
  // "no identity document" and "not your business" survives to the screen.
  return 'national_id' in farmer ? { ...fields, nationalId: farmer.national_id ?? null } : fields;
}

export interface CaseloadSummary {
  /** Farmers held right now. A floor when `complete` is false. */
  readonly shown: number;
  /** Rejected records: the ones with a move the officer can make. */
  readonly needingAttention: number;
  /** False when the route said there are more pages. */
  readonly complete: boolean;
}

/**
 * What the header may claim.
 *
 * `complete` is the whole point: `GET /api/farmers` is cursor-paged and a page
 * is not a caseload. When more pages exist the screen says "First N" rather
 * than printing N as a total, which is the rule the officer dashboard had to
 * learn the same week.
 */
export function caseloadSummary(farmers: readonly Farmer[], hasMore: boolean): CaseloadSummary {
  return {
    shown: farmers.length,
    needingAttention: farmers.filter((f) => canResubmit(f)).length,
    complete: !hasMore,
  };
}
