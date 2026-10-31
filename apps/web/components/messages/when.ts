import { formatDate } from '@/lib/format';
import type { Language } from '@/lib/i18n';

/**
 * 2026-10-31 (ui-delight): the day words a chat and a notifications list are
 * grouped under -- "Today", "Yesterday", then the date -- and the short clock
 * time beside a message. Calendar days on this phone, not 24-hour spans, so
 * a message from 23:50 is "Yesterday" ten minutes later. Read-only helpers:
 * nothing here changes what is loaded or when.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** This phone's calendar day of a moment, YYYY-MM-DD, for grouping. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Whole calendar days between a moment and now (0 today, 1 yesterday). */
function daysAgo(iso: string, now: Date): number {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return Number.POSITIVE_INFINITY;
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((start(now) - start(d)) / 86_400_000);
}

export type DayBucket = 'today' | 'yesterday' | 'earlier';

export function dayBucket(iso: string, now: Date = new Date()): DayBucket {
  const ago = daysAgo(iso, now);
  return ago <= 0 ? 'today' : ago === 1 ? 'yesterday' : 'earlier';
}

export function bucketLabel(bucket: DayBucket, language: Language): string {
  if (bucket === 'today') return language === 'ar' ? 'اليوم' : 'Today';
  if (bucket === 'yesterday') return language === 'ar' ? 'أمس' : 'Yesterday';
  return language === 'ar' ? 'أقدم' : 'Earlier';
}

/** The divider over a day's messages: Today, Yesterday, or the date. */
export function dayLabel(iso: string, language: Language, now: Date = new Date()): string {
  const bucket = dayBucket(iso, now);
  return bucket === 'earlier' ? formatDate(iso, language) : bucketLabel(bucket, language);
}

/** "14:05", in the reader's language (Arabic digits in Arabic). */
export function clockTime(iso: string, language: Language): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(language === 'ar' ? 'ar' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** An inbox row's time: the clock today, "Yesterday", then the date. */
export function inboxTime(iso: string, language: Language, now: Date = new Date()): string {
  const bucket = dayBucket(iso, now);
  if (bucket === 'today') return clockTime(iso, language);
  return bucket === 'yesterday' ? bucketLabel(bucket, language) : formatDate(iso, language);
}

/** "Mary K." -> "MK"; one letter for a one-word name. Works for Arabic names too. */
export function initials(name: string): string {
  const words = name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0] ?? '');
  return letters.join('').toUpperCase() || '?';
}

/** A steady colour per name (one of four token pairs), so a person keeps theirs. */
export function avatarTone(name: string): 0 | 1 | 2 | 3 {
  let h = 0;
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return (h % 4) as 0 | 1 | 2 | 3;
}

/** Rows (newest first) gathered under Today, Yesterday and Earlier, in their order. */
export function groupByDay<T extends { created_at: string }>(
  rows: readonly T[],
  now: Date = new Date(),
): { bucket: DayBucket; rows: T[] }[] {
  const groups: { bucket: DayBucket; rows: T[] }[] = [];
  for (const row of rows) {
    const bucket = dayBucket(row.created_at, now);
    const group = groups.find((g) => g.bucket === bucket);
    if (group) group.rows.push(row);
    else groups.push({ bucket, rows: [row] });
  }
  return groups;
}

/** A notice's time: the clock under Today and Yesterday, the date under Earlier. */
export function noticeTime(iso: string, language: Language, now: Date = new Date()): string {
  return dayBucket(iso, now) === 'earlier' ? formatDate(iso, language) : clockTime(iso, language);
}
