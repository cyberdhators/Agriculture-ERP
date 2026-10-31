import { t, type Language } from '@/lib/i18n';

import styles from './listings.module.css';

/**
 * 2026-10-31 (the owner): ONLY ORGANISATIONS ARE VERIFIED. This replaces the
 * "Verified farmer" badge of 2026-10-19: a person's own account -- a farmer,
 * an individual buyer -- is never verified, so nothing about one shows here.
 * Shown only when CORWADO staff have verified the organisation behind a post
 * or profile, never used to filter, and an unverified organisation shows
 * nothing rather than a "pending" stamp a reader would take as a warning.
 *
 * 2026-10-31 (delight, "trust you can see"): a small green tick disc and the
 * words, instead of the inked uppercase stamp, so it reads as a mark at a
 * glance. The words stay: the tick alone would mean nothing to a new reader.
 */
export function VerifiedOrganisationBadge({
  verified,
  lang,
}: {
  verified: boolean;
  lang: Language;
}) {
  if (!verified) return null;
  return (
    <span className={styles.verifiedTick}>
      <svg className={styles.verifiedTickIcon} viewBox="0 0 16 16" aria-hidden focusable="false">
        <circle cx="8" cy="8" r="8" />
        <path d="M4.6 8.3 7 10.6l4.4-4.9" />
      </svg>
      {t('market.verifiedOrganisation', lang)}
    </span>
  );
}
