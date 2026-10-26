/**
 * ONLINE NOW AND LAST ACTIVE, IN CONVERSATIONS ONLY (2026-10-26).
 * docs/DECISIONS.md, "Online status in conversations".
 *
 * Shown in exactly two places: a conversation's header under the other
 * party's name, and a small dot in the conversation lists. Never on the
 * public market, a profile, a listing, or to anyone without a session.
 *
 * THE RULE IS RECIPROCAL, as in WhatsApp: a person who hides their own
 * activity sees nobody else's. It is decided on the server, by
 * `counterpartVisible`, before anything leaves the API.
 */

export interface PresenceFacts {
  /** The reader has a farmer or buyer session. */
  viewerSignedIn: boolean;
  /** The reader's own "show when I'm active" switch. */
  viewerShows: boolean;
  /** Who the other side is: one person, an organisation's shared inbox, or staff. */
  counterpart: 'person' | 'organization' | 'staff';
  /** The other person's own switch. */
  counterpartShows: boolean;
}

/**
 * Whether the reader may see the other side's online status and last
 * activity. Only a person is ever shown: an organisation's inbox is a team,
 * and a team member's activity is never shown to the outside party; staff
 * never appear online to the public.
 */
export function counterpartVisible(f: PresenceFacts): boolean {
  if (!f.viewerSignedIn) return false;
  if (f.counterpart !== 'person') return false;
  return f.viewerShows && f.counterpartShows;
}

/** What a conversation carries about the other side, when visible. */
export interface CounterpartPresence {
  online: boolean;
  /**
   * ISO time last seen: the exact moment the app was last closed or hidden
   * when that is known and current (`exact`), otherwise the last API
   * activity (moved at most every five minutes).
   */
  last_active_at: string | null;
  /** 2026-11-01: last_active_at is an exact last-seen time, not the coarse stamp. */
  exact?: boolean;
}

/**
 * 2026-11-01: the client's "bye" (the app closed or hidden) is recorded at
 * most once per account per this long (account_activity.presence_seen_at).
 */
export const PRESENCE_BYE_THROTTLE_MS = 30_000;

/** Whether a bye at `nowMs` is recorded, given the last one recorded for the account. */
export const shouldRecordBye = (lastMs: number | undefined, nowMs: number): boolean =>
  lastMs === undefined || nowMs - lastMs >= PRESENCE_BYE_THROTTLE_MS;

/**
 * WHICH LAST-SEEN TIME TO SHOW (2026-11-01). The exact time the app was last
 * closed or hidden is preferred over the coarse activity stamp -- unless the
 * stamp is NEWER, which means the person was active again after that bye
 * (another phone, or the bye was lost), and then the stamp is the truer one.
 */
export function lastSeenOf(input: {
  presenceSeenAt: Date | null | undefined;
  activitySeenAt: Date | null | undefined;
}): { at: Date; exact: boolean } | null {
  const exact = input.presenceSeenAt ?? null;
  const coarse = input.activitySeenAt ?? null;
  if (exact && (!coarse || exact.getTime() >= coarse.getTime())) return { at: exact, exact: true };
  if (coarse) return { at: coarse, exact: false };
  return null;
}

/** The time zone CORWADO works in. "Yesterday" means yesterday in Juba. */
export const JUBA_TIME_ZONE = 'Africa/Juba';

export type ActiveLabel =
  | { kind: 'online' }
  | { kind: 'just_now' }
  | { kind: 'minutes'; n: number }
  | { kind: 'hours'; n: number }
  | { kind: 'yesterday' }
  | { kind: 'days'; n: number }
  | { kind: 'weeks' }
  | { kind: 'unknown' };

/** The calendar date in Juba, as YYYY-MM-DD. */
function jubaDate(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: JUBA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

const DAY_MS = 86_400_000;

/** Whole Juba calendar days between two instants. */
function calendarDays(fromMs: number, toMs: number): number {
  return Math.round((Date.parse(jubaDate(toMs)) - Date.parse(jubaDate(fromMs))) / DAY_MS);
}

/**
 * RELATIVE TIME. From the coarse activity stamp, under five minutes is "just
 * now" (it is only recorded every five minutes, so anything finer would be
 * invented); from an exact last-seen time (2026-11-01), under one minute. Then
 * minutes, hours while still today in Juba, "yesterday", days up to a week,
 * then "over a week ago".
 */
export function activeLabel(
  presence: CounterpartPresence | null | undefined,
  nowMs: number,
): ActiveLabel {
  if (!presence) return { kind: 'unknown' };
  if (presence.online) return { kind: 'online' };
  if (!presence.last_active_at) return { kind: 'unknown' };
  const at = Date.parse(presence.last_active_at);
  if (Number.isNaN(at)) return { kind: 'unknown' };
  const ago = Math.max(0, nowMs - at);
  if (ago < (presence.exact ? 60_000 : 5 * 60_000)) return { kind: 'just_now' };
  const days = calendarDays(at, nowMs);
  if (days <= 0) {
    if (ago < 60 * 60_000) return { kind: 'minutes', n: Math.floor(ago / 60_000) };
    return { kind: 'hours', n: Math.floor(ago / (60 * 60_000)) };
  }
  if (days === 1) return { kind: 'yesterday' };
  if (days < 7) return { kind: 'days', n: days };
  return { kind: 'weeks' };
}

/** The label in English or Arabic. Arabic numbers stay Western digits, as elsewhere in the app. */
export function activeLabelText(label: ActiveLabel, language: 'en' | 'ar'): string | null {
  const ar = language === 'ar';
  switch (label.kind) {
    case 'online':
      return ar ? 'متصل الآن' : 'Online';
    case 'just_now':
      return ar ? 'نشط قبل لحظات' : 'Active just now';
    case 'minutes':
      return ar
        ? `نشط قبل ${label.n} ${label.n === 1 ? 'دقيقة' : 'دقائق'}`
        : `Active ${label.n} ${label.n === 1 ? 'minute' : 'minutes'} ago`;
    case 'hours':
      return ar
        ? `نشط قبل ${label.n} ${label.n === 1 ? 'ساعة' : 'ساعات'}`
        : `Active ${label.n} ${label.n === 1 ? 'hour' : 'hours'} ago`;
    case 'yesterday':
      return ar ? 'نشط أمس' : 'Active yesterday';
    case 'days':
      return ar ? `نشط قبل ${label.n} أيام` : `Active ${label.n} days ago`;
    case 'weeks':
      return ar ? 'نشط منذ أكثر من أسبوع' : 'Active over a week ago';
    default:
      return null;
  }
}

/**
 * 2026-11-01: how soon a shown label should be worked out again, so "Active
 * just now" becomes "Active 1 minute ago" without a reload. Every 30 seconds
 * while counted in minutes, every minute after; never for "Online" (that
 * changes only when the conversation is read again) or when nothing is shown.
 */
export const PRESENCE_TICK_FAST_MS = 30_000;
export const PRESENCE_TICK_SLOW_MS = 60_000;

export function presenceTickMs(label: ActiveLabel): number | null {
  switch (label.kind) {
    case 'just_now':
    case 'minutes':
      return PRESENCE_TICK_FAST_MS;
    case 'hours':
    case 'yesterday':
    case 'days':
      return PRESENCE_TICK_SLOW_MS;
    default:
      return null;
  }
}
