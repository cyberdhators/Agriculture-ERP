'use client';

import { useEffect, useState } from 'react';

import {
  activeLabel,
  activeLabelText,
  presenceTickMs,
  type CounterpartPresence,
} from '@agri-erp/shared';

import type { Language } from '@/lib/i18n';

import styles from './live.module.css';

/**
 * "Online" with a green dot, or "Active 5 minutes ago", for the other person
 * in a conversation (2026-10-26). Renders nothing when the API sent no
 * presence -- which it does whenever either side hides their activity, the
 * other side is an organisation's team, or nothing is known.
 *
 * 2026-11-01: the label works itself out again on a timer (every 30 seconds
 * while in minutes, every minute after: shared presenceTickMs), so "Active
 * just now" becomes "Active 1 minute ago" without a reload; a new `presence`
 * from the open chat's poll flips "Online" at once.
 */
export function PresenceLine({
  presence,
  language,
  dotOnly = false,
}: {
  presence: CounterpartPresence | null | undefined;
  language: Language;
  /** In a list: only the green dot, and only when online. */
  dotOnly?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  const label = activeLabel(presence, now);
  const tick = presenceTickMs(label);
  useEffect(() => {
    setNow(Date.now());
  }, [presence]);
  useEffect(() => {
    if (tick === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), tick);
    return () => window.clearInterval(timer);
  }, [tick]);
  const text = activeLabelText(label, language === 'ar' ? 'ar' : 'en');
  if (!text) return null;
  const online = label.kind === 'online';
  if (dotOnly) {
    return online ? (
      <span className={`${styles.dot} ${styles.dotOnline}`} role="img" aria-label={text} />
    ) : null;
  }
  return (
    <span className={styles.presence}>
      <span className={`${styles.dot} ${online ? styles.dotOnline : ''}`} aria-hidden />
      <span className={online ? styles.online : undefined}>{text}</span>
    </span>
  );
}
