import type { Farmer } from '@/lib/fixtures/farmers';
import type { Visit } from '@/lib/visits/api';

/**
 * THE OFFICER DASHBOARD'S MODEL, AS PURE FUNCTIONS.
 *
 * The officer's screen answers ONE question — "what do I need to do today?" —
 * and the administrator's answers "what is happening across the programme".
 * They are different questions, so this is not the dashboard model with a
 * narrower scope; it is a different model.
 *
 * NOTHING HERE INVENTS A FIGURE. Every value is computed from rows a route
 * already returns to an officer:
 *
 *   - `GET /api/farmers`  — the caller's own caseload, scoped server-side by
 *     `caseload_officer_id`. The officer cannot widen it with a filter.
 *   - `GET /api/visits?from&to` — the same, with the date window the officer's
 *     day needs.
 *
 * WHAT IS DELIBERATELY ABSENT, and each absence is a decision:
 *
 *   - **No "due today".** The backend has no concept of a visit being DUE: a
 *     visit is recorded after it happens, never scheduled before. A count
 *     labelled "due" would be a number the database cannot produce.
 *     `visitsToday` is what was RECORDED today, which is a fact.
 *   - **No activity feed.** `GET /api/audit` is administrator-only (C-4.8) and
 *     no officer-visible history exists.
 *   - **No verification figures.** Verifying, rejecting, merging and
 *     reassigning are the supervisor's and the administrator's; an officer's
 *     screen showing progress towards them would offer decisions it cannot
 *     make.
 */

/** A farmer's state as the officer's screen groups it. */
export type CaseloadGroup = 'pending' | 'rejected' | 'verified' | 'merged';

export function groupOf(
  farmer: Pick<Farmer, 'verification_status' | 'merged_into'>,
): CaseloadGroup {
  if (farmer.merged_into) return 'merged';
  const status = farmer.verification_status;
  return status === 'verified' || status === 'rejected' || status === 'pending'
    ? status
    : 'pending';
}

export interface CaseloadCounts {
  /** Everyone on this officer's caseload, merged records excluded (C-6.8). */
  readonly total: number;
  readonly pending: number;
  readonly rejected: number;
  readonly verified: number;
  /**
   * FALSE WHEN THE LIST WAS CUT SHORT BY PAGING, AND THE UI MUST SAY SO.
   *
   * `GET /api/farmers` is cursor-paged and returns `hasMore`. A dashboard that
   * asks for the first page and prints `total` as a fact is printing the size
   * of a PAGE and calling it a caseload. On an officer with more farmers than
   * the page holds, every figure here is a floor rather than a number -- which
   * is the shape of every figure this project has had to take back.
   */
  readonly complete: boolean;
}

/**
 * Counts the officer's own caseload. A merged record is not a person waiting
 * on anything, so it is excluded from `total` rather than counted twice --
 * the same rule the reporting views use.
 */
export function caseloadCounts(
  farmers: readonly Pick<Farmer, 'verification_status' | 'merged_into'>[],
  complete = true,
): CaseloadCounts {
  let pending = 0;
  let rejected = 0;
  let verified = 0;
  let merged = 0;
  for (const farmer of farmers) {
    const group = groupOf(farmer);
    if (group === 'pending') pending += 1;
    else if (group === 'rejected') rejected += 1;
    else if (group === 'verified') verified += 1;
    else merged += 1;
  }
  return { total: farmers.length - merged, pending, rejected, verified, complete };
}

/** The local day as the officer experiences it, as the ISO instants a filter takes. */
export function dayWindow(now: Date): { from: string; to: string } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

/**
 * What the officer has recorded today, and who it was with.
 *
 * `visited_at` is the officer's own moment (C-8.5) rather than the server's,
 * because the question is "what have I done today", not "what did the server
 * receive today".
 */
export function visitsToday(
  visits: readonly Pick<Visit, 'id' | 'visited_at' | 'farmer_id'>[],
  now: Date,
  complete = true,
): { count: number; farmersSeen: number; complete: boolean } {
  const { from, to } = dayWindow(now);
  const todays = visits.filter((v) => v.visited_at >= from && v.visited_at < to);
  return {
    count: todays.length,
    farmersSeen: new Set(todays.map((v) => v.farmer_id)).size,
    complete,
  };
}

/**
 * The window to ASK the server for, which is wider than the day being counted.
 *
 * `GET /api/visits?from&to` filters `received_at` -- the moment the server took
 * the record -- while this dashboard counts `visited_at`, the moment the
 * officer was standing in the field (C-8.5). Those are the same instant on the
 * web desk and will stop being so the day the Android application syncs a
 * morning's work in the afternoon. Asking for a day either side means a visit
 * MADE today is still fetched when it ARRIVES late, and the client-side filter
 * then counts the right day.
 */
export function fetchWindow(now: Date): { from: string; to: string } {
  const { from, to } = dayWindow(now);
  const earlier = new Date(from);
  earlier.setDate(earlier.getDate() - 1);
  const later = new Date(to);
  later.setDate(later.getDate() + 1);
  return { from: earlier.toISOString(), to: later.toISOString() };
}

/**
 * The farmers this officer can actually act on, in the order the day should
 * take them.
 *
 * REJECTED FIRST, AND THE REASON MATTERS. A rejected registration is the only
 * state where an officer has a move: correct it and resubmit
 * (`POST /api/farmers/:id/resubmit`, officer-only). Pending farmers are waiting
 * on somebody ELSE, so they are shown for awareness and carry no action. That
 * ordering is the whole point of the panel: it puts the work the officer can
 * finish above the work they can only watch.
 */
export interface AttentionRow {
  readonly farmer: Farmer;
  readonly group: Extract<CaseloadGroup, 'pending' | 'rejected'>;
  /** True only where a route exists that this officer may call. */
  readonly officerCanAct: boolean;
}

export function needingAttention(farmers: readonly Farmer[], limit = 6): AttentionRow[] {
  const rows: AttentionRow[] = [];
  for (const farmer of farmers) {
    const group = groupOf(farmer);
    if (group === 'rejected') rows.push({ farmer, group, officerCanAct: true });
    else if (group === 'pending') rows.push({ farmer, group, officerCanAct: false });
  }
  return rows
    .sort((a, b) => {
      if (a.group !== b.group) return a.group === 'rejected' ? -1 : 1;
      return a.farmer.created_at < b.farmer.created_at ? -1 : 1;
    })
    .slice(0, limit);
}
