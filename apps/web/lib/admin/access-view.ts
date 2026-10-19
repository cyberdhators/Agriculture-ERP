import { DISPLAY_TIME_ZONE, DISPLAY_UTC_OFFSET } from '@agri-erp/shared';

/**
 * Presentation helpers for the access-log and staff-access screens
 * (2026-10-19). Pure, so they are tested without a browser.
 *
 * Times travel as UTC and are SHOWN in Africa/Juba, whatever the reader's own
 * device clock says -- an administrator in Nairobi and one in Juba must read
 * the same time for the same event.
 */

const JUBA = new Intl.DateTimeFormat('en-GB', {
  timeZone: DISPLAY_TIME_ZONE,
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** `2026-10-19T10:05:00Z` -> `19 Oct 2026, 12:05` (Juba time). */
export function formatJubaTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : JUBA.format(d);
}

/**
 * A date picked on the screen, as the instant that day starts (or ends) in
 * Juba. `to` covers the whole of its day.
 */
export function jubaDayBound(date: string, edge: 'start' | 'end'): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  return edge === 'start'
    ? `${date}T00:00:00${DISPLAY_UTC_OFFSET}`
    : `${date}T23:59:59.999${DISPLAY_UTC_OFFSET}`;
}

export const ACTOR_KIND_LABELS: Record<string, string> = {
  user: 'Staff',
  officer: 'Extension officer',
  buyer: 'Buyer',
  farmer: 'Farmer',
};

/** A staff or officer name; for a farmer or buyer, the kind and a short id -- never a name. */
export function accountLabel(entry: {
  actor_kind: string;
  actor_id: string;
  actor_name: string | null;
}): string {
  if (entry.actor_name) return entry.actor_name;
  return `${ACTOR_KIND_LABELS[entry.actor_kind] ?? entry.actor_kind} ${entry.actor_id.slice(0, 8)}`;
}
