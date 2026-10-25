import {
  ACCESS_EVENT_LABELS,
  ACCOUNT_STATUS_LABELS,
  ADVISORY_STATUS_LABELS,
  DISPLAY_TIME_ZONE,
  OVERVIEW_ACTOR_LABELS,
  type AccessEvent,
  type AccountStatus,
  type AdminAccountRow,
} from '@agri-erp/shared';

/**
 * WORDS FOR THE ACCOUNTS SCREENS (2026-10-28). Pure, so tested without a
 * browser (accounts-view.test.ts): how a date-time, an actor type, a status,
 * a verification and an event read in the list and on the account page.
 */

/** "12 Mar 2025, 10:24" in Juba time, or "—". */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: DISPLAY_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/** "3 hours ago" style, for last active; "—" when never. */
export function timeAgo(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const ms = now.getTime() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '—';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** An actor type in words ("Processor"); an unknown key is shown as itself, tidied. */
export function actorLabel(key: string): string {
  const plural = (OVERVIEW_ACTOR_LABELS as Record<string, string>)[key];
  if (plural) return plural.replace(/s$/, '').replace(/Financial service$/, 'Financial services');
  return words(key);
}

export const words = (s: string): string =>
  s.replace(/[_.]/g, ' ').replace(/^./, (c) => c.toUpperCase());

export const statusLabel = (s: AccountStatus): string => ACCOUNT_STATUS_LABELS[s];

/** The stamp a status wears. */
export const statusStamp = (s: AccountStatus): 'verified' | 'pending' | 'rejected' | 'neutral' =>
  s === 'active'
    ? 'verified'
    : s === 'suspended'
      ? 'pending'
      : s === 'disabled'
        ? 'rejected'
        : 'neutral';

/**
 * How a row's verification reads (2026-10-31: only organisations are
 * verified). An organisational profile: verified or not verified. A person:
 * their phone confirmation (contact verification, not account verification)
 * and, when they buy for a business, that organisation's verification. An
 * individual has no verification at all, so nothing is printed for one.
 */
export function verificationLabel(
  row: Pick<AdminAccountRow, 'verification' | 'phone_verified'> & {
    kind?: AdminAccountRow['kind'];
  },
): string {
  if (row.kind === 'organisation') {
    return row.verification === 'verified' ? 'Verified organisation' : 'Organisation not verified';
  }
  const parts: string[] = [];
  if (row.phone_verified) parts.push('Phone confirmed');
  if (row.verification) {
    parts.push(
      row.verification === 'verified'
        ? 'Buyer organisation verified'
        : `Buyer organisation ${row.verification.replace(/_/g, ' ')}`,
    );
  }
  return parts.join(' · ');
}

/** The public profile's state in words. */
export function publicationLabel(p: string): string {
  if (p === 'published') return 'Profile published';
  if (p === 'draft') return 'Profile draft';
  if (p === 'unpublished') return 'Profile unpublished';
  if (p === 'closed') return 'Closed';
  if (p === 'none') return 'No public profile';
  return words(p);
}

export const advisoryLabel = (a: AdminAccountRow['advisory']): string => ADVISORY_STATUS_LABELS[a];

/** A timeline line: an access event's label, or an audit action key in words. */
export function eventLabel(source: 'access' | 'action', event: string): string {
  if (source === 'access') {
    return (ACCESS_EVENT_LABELS as Record<string, string>)[event as AccessEvent] ?? words(event);
  }
  return words(event);
}

/** The sign-in method in words. */
export const signInLabel = (m: AdminAccountRow['sign_in']): string =>
  m === 'phone' ? 'Phone account' : m === 'email' ? 'Email account' : 'No sign-in';

/** Where a row opens: the account page, or the organisations screen for an organisation. */
export const accountHref = (row: Pick<AdminAccountRow, 'kind' | 'id' | 'name'>): string =>
  row.kind === 'organisation'
    ? `/admin/organizations?q=${encodeURIComponent(row.name)}`
    : `/admin/accounts/${row.kind}/${row.id}`;
