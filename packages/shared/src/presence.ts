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
  /** ISO time of the last API activity (moved at most every five minutes). */
  last_active_at: string | null;
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
 * COARSE RELATIVE TIME. Under five minutes is "just now" (activity is only
 * recorded every five minutes, so anything finer would be invented); then
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
  if (ago < 5 * 60_000) return { kind: 'just_now' };
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
