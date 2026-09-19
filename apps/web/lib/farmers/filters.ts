import { VERIFICATION_STATUSES, type VerificationStatus } from '@agri-erp/shared';

import type { FarmerListParams } from './api';

/**
 * THE REGISTER'S FILTERS: WHAT THE ROUTE ACTUALLY ACCEPTS, AND NOTHING ELSE.
 *
 * `farmerFilterSchema` in packages/shared is the contract. It takes a
 * verification status, a county, a payam, a sex, a registration window, an
 * updated-since moment and a duplicate flag. It takes NO free text — no name,
 * no phone, no farmer number — and it takes NO state.
 *
 * Both absences shape the screen:
 *
 *   - There is no search box on the register, because a box that filtered only
 *     the rows already downloaded would answer "no such farmer" for a farmer
 *     who is simply on page four.
 *   - State is offered as a way to NARROW THE COUNTY AND PAYAM LISTS, never as
 *     a filter of its own. Choosing a state alone changes no query, so it
 *     produces no chip and the screen says what to pick next. Sending it would
 *     be rejected by a strict schema anyway.
 *
 * DATES. The schema wants ISO timestamps with an offset; the form offers date
 * pickers. A "to" date means the END of that day — a filter reading
 * "registered to 3 September" that silently excluded everything registered on
 * 3 September would be wrong in the direction nobody checks.
 */

/** The keys this screen keeps in the URL. `state` is a picker aid, not a filter. */
export interface RegisterFilters {
  status: string;
  state: string;
  county: string;
  payam: string;
  sex: string;
  duplicate: string;
  registered_from: string;
  registered_to: string;
  updated_since: string;
}

export const EMPTY_FILTERS: RegisterFilters = {
  status: '',
  state: '',
  county: '',
  payam: '',
  sex: '',
  duplicate: '',
  registered_from: '',
  registered_to: '',
  updated_since: '',
};

export const FILTER_KEYS = Object.keys(EMPTY_FILTERS) as (keyof RegisterFilters)[];

/** Tabs exist only where the route can answer them. */
export const STATUS_TABS: ReadonlyArray<{ key: string; label: string }> = [
  { key: '', label: 'All farmers' },
  { key: 'pending', label: 'Pending verification' },
  { key: 'verified', label: 'Verified' },
  { key: 'rejected', label: 'Rejected' },
];

/**
 * Merged records have NO tab.
 *
 * `merged` is not a verification status — the statuses are pending, verified
 * and rejected, and a merge is recorded as a pointer on the row. There is no
 * filter that asks for merged records, so a "Merged" tab would either return
 * everything or silently return the wrong thing. It is named here so the next
 * reader knows it was considered rather than forgotten.
 */
export const MERGED_TAB_UNAVAILABLE =
  'Merged records have no tab: merging is recorded as a pointer on the record, not as a verification status, and the list route cannot filter on it.';

const isStatus = (value: string): value is VerificationStatus =>
  (VERIFICATION_STATUSES as readonly string[]).includes(value);

const startOfDay = (date: string): string => `${date}T00:00:00.000Z`;
/** Inclusive: a day filter that excluded that day's own records would be a trap. */
const endOfDay = (date: string): string => `${date}T23:59:59.999Z`;

/**
 * The query the route will actually be sent.
 *
 * Anything the schema does not define is dropped here rather than at the
 * network boundary, because `farmerFilterSchema` is a strict object: one
 * unknown key and the whole request is a 400 naming a field the reader never
 * typed.
 */
export function toListParams(filters: RegisterFilters, cursor?: string): FarmerListParams {
  const params: FarmerListParams = {};
  if (isStatus(filters.status)) params.verification_status = filters.status;
  if (filters.county) params.county = filters.county;
  if (filters.payam) params.payam = filters.payam;
  if (filters.sex === 'f' || filters.sex === 'm') params.sex = filters.sex;
  if (filters.duplicate === 'true' || filters.duplicate === 'false') {
    params.duplicate_flag = filters.duplicate;
  }
  if (filters.registered_from) params.registered_from = startOfDay(filters.registered_from);
  if (filters.registered_to) params.registered_to = endOfDay(filters.registered_to);
  if (filters.updated_since) params.updated_since = startOfDay(filters.updated_since);
  if (cursor) params.cursor = cursor;
  return params;
}

/** Read the filters out of the URL, ignoring anything that is not one of ours. */
export function fromQuery(get: (key: string) => string): RegisterFilters {
  const filters = { ...EMPTY_FILTERS };
  for (const key of FILTER_KEYS) filters[key] = get(key) ?? '';
  return filters;
}

/** Clearing means clearing: every key written as null so the URL loses it. */
export const clearPatch = (): Record<string, null> =>
  Object.fromEntries(FILTER_KEYS.map((key) => [key, null]));

export interface FilterChip {
  /** The filter key to clear when the chip's remove button is pressed. */
  key: keyof RegisterFilters;
  label: string;
}

export interface ChipNames {
  county?: (id: string) => string | undefined;
  payam?: (id: string) => string | undefined;
  state?: (id: string) => string | undefined;
}

const SEX_LABEL: Record<string, string> = { f: 'Female', m: 'Male' };
const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending verification',
  verified: 'Verified',
  rejected: 'Rejected',
};

/**
 * The active filters, as removable chips.
 *
 * The status chip is deliberately absent: status is the tab, and a chip that
 * removed it would fight the tab strip for the same piece of state. `state` is
 * absent because it filters nothing.
 */
export function activeChips(filters: RegisterFilters, names: ChipNames = {}): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filters.county) {
    chips.push({
      key: 'county',
      label: `County: ${names.county?.(filters.county) ?? filters.county}`,
    });
  }
  if (filters.payam) {
    chips.push({ key: 'payam', label: `Payam: ${names.payam?.(filters.payam) ?? filters.payam}` });
  }
  if (filters.sex)
    chips.push({ key: 'sex', label: `Sex: ${SEX_LABEL[filters.sex] ?? filters.sex}` });
  if (filters.duplicate === 'true') {
    chips.push({ key: 'duplicate', label: 'Possible duplicates only' });
  }
  if (filters.duplicate === 'false') {
    chips.push({ key: 'duplicate', label: 'Excluding possible duplicates' });
  }
  if (filters.registered_from) {
    chips.push({ key: 'registered_from', label: `Registered from ${filters.registered_from}` });
  }
  if (filters.registered_to) {
    chips.push({ key: 'registered_to', label: `Registered to ${filters.registered_to}` });
  }
  if (filters.updated_since) {
    chips.push({ key: 'updated_since', label: `Changed since ${filters.updated_since}` });
  }
  return chips;
}

/** Whether anything narrows the list — the difference between "empty" and "no match". */
export const hasActiveFilters = (filters: RegisterFilters): boolean =>
  activeChips(filters).length > 0 || filters.status !== '';

/** Human label for a status tab, for the empty state's sentence. */
export const statusLabel = (status: string): string => STATUS_LABEL[status] ?? 'All farmers';
