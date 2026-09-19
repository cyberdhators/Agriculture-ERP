import type { RegisterFilters } from './filters';
import { statusLabel } from './filters';

/**
 * WHAT THE REGISTER PRINTS, AND WHAT "SELECTED" MEANS.
 *
 * Both answers are here rather than in the component, because both are easy to
 * get quietly wrong and impossible to notice by looking: a printed page that
 * does not say which filters produced it is a sheet of numbers nobody can
 * check a week later, and a selection count that spans pages the reader never
 * saw is a lie told in a small font.
 */

export interface PrintContext {
  /** Human sentences describing the query that produced the page. */
  readonly lines: string[];
  /** True when nothing narrows the register, so the print says so explicitly. */
  readonly unfiltered: boolean;
}

export interface PlaceNames {
  county?: (id: string) => string | undefined;
  payam?: (id: string) => string | undefined;
  state?: (id: string) => string | undefined;
}

const SEX_LABEL: Record<string, string> = { f: 'Female', m: 'Male' };

/**
 * The filter summary printed under the title.
 *
 * Every applied filter appears, spelled out. `state` appears too — even though
 * it is never sent to the route — because on paper it explains why the county
 * list the operator chose from was short, and omitting it would make the sheet
 * harder to reproduce rather than cleaner.
 */
export function printContext(filters: RegisterFilters, names: PlaceNames = {}): PrintContext {
  const lines: string[] = [];
  lines.push(`View: ${statusLabel(filters.status)}`);
  if (filters.state) lines.push(`State: ${names.state?.(filters.state) ?? filters.state}`);
  if (filters.county) lines.push(`County: ${names.county?.(filters.county) ?? filters.county}`);
  if (filters.payam) lines.push(`Payam: ${names.payam?.(filters.payam) ?? filters.payam}`);
  if (filters.sex) lines.push(`Sex: ${SEX_LABEL[filters.sex] ?? filters.sex}`);
  if (filters.duplicate === 'true') lines.push('Possible duplicates only');
  if (filters.duplicate === 'false') lines.push('Excluding possible duplicates');
  if (filters.registered_from) lines.push(`Registered from: ${filters.registered_from}`);
  if (filters.registered_to) lines.push(`Registered to: ${filters.registered_to}`);
  if (filters.updated_since) lines.push(`Changed since: ${filters.updated_since}`);
  // "View: All farmers" alone is not a narrowing, so the sheet says so.
  const unfiltered = lines.length === 1 && filters.status === '';
  if (unfiltered) lines.push('No filters applied');
  return { lines, unfiltered };
}

/**
 * The line under the title that says WHICH ROWS these are.
 *
 * The route pages by cursor and never reports a total, so a printed register
 * is a page of a larger thing and must say so. "Page 3 of 19" would be an
 * invention; "25 rows on this page, more available" is what is actually known.
 */
export function printRowNote(shown: number, hasMore: boolean): string {
  if (shown === 0) return 'No rows on this page.';
  const rows = `${shown.toLocaleString('en')} ${shown === 1 ? 'row' : 'rows'} on this page`;
  return hasMore
    ? `${rows}. The register continues beyond it; print further pages from the register itself.`
    : `${rows}. This is the last page of the current view.`;
}

/* ---- Selection -------------------------------------------------------- */

/**
 * Selection is scoped to the page in front of the reader, and the wording says
 * so.
 *
 * Cursor paging means the client never holds the whole register — it holds one
 * page and a cursor. A tick on page one therefore cannot mean anything about
 * page four, which was never loaded and may not even have been computed yet.
 * Rather than keep a set that silently spans pages the reader cannot see, the
 * selection is cleared whenever the page or the query changes, and every label
 * ends in "on this page".
 */
export function selectionLabel(count: number): string {
  if (count === 0) return 'None selected on this page';
  return `${count.toLocaleString('en')} ${count === 1 ? 'farmer' : 'farmers'} selected on this page`;
}

/**
 * Which rows may be ticked, given the reader's role.
 *
 * NOTE THE ABSENCE OF A BULK OPERATION. No route in this system takes a list
 * of farmer ids — there is no bulk verify, no bulk reject, no bulk reassign,
 * no bulk remove. Selection is a reading aid: it marks the records an
 * administrator or supervisor is working through, and the only action beside
 * it is a link to the verification queue, which is where decisions are made
 * one at a time with their reasons recorded. Ticking boxes must never look
 * like it can do more than that.
 */
export const canSelect = (role: string): boolean => role === 'admin' || role === 'supervisor';

/** Selection restricted to what is actually on the page, so a stale id cannot survive. */
export function prunedSelection(
  selected: ReadonlySet<string>,
  pageIds: readonly string[],
): Set<string> {
  const onPage = new Set(pageIds);
  return new Set([...selected].filter((id) => onPage.has(id)));
}

/** Toggle one row, returning a new set rather than mutating the old one. */
export function toggleSelection(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Select-all applies to this page and nothing beyond it. */
export function toggleAllOnPage(
  selected: ReadonlySet<string>,
  pageIds: readonly string[],
): Set<string> {
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  return allSelected ? new Set() : new Set(pageIds);
}
