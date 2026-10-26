'use client';

import { activeLabel, activeLabelText, type CounterpartPresence } from '@agri-erp/shared';

import type { Language } from '@/lib/i18n';

import styles from './live.module.css';

/**
 * "Online" with a green dot, or "Active 5 minutes ago", for the other person
 * in a conversation (2026-10-26). Renders nothing when the API sent no
 * presence -- which it does whenever either side hides their activity, the
 * other side is an organisation's team, or nothing is known.
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
  const label = activeLabel(presence, Date.now());
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
