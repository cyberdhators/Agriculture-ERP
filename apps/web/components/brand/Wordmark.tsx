import Link from 'next/link';

import styles from './brand.module.css';

/**
 * The AgriOne wordmark, set in Fraunces: "Agri" regular, "One" semibold, and
 * the tittle of the i replaced by one sprout-green dot. A dotless ı carries
 * the letterform so the dot is ours, not the font's. Optionally the tagline
 * beneath in 11px letter-spaced caps. `onBand` inverts it for the forest band.
 */
export function Wordmark({
  size = 22,
  tagline = false,
  onBand = false,
  href,
  taglineText = 'Digital Agriculture & Agribusiness Ecosystem',
}: {
  size?: number;
  tagline?: boolean;
  onBand?: boolean;
  href?: string;
  taglineText?: string;
}) {
  const className = `${styles.wordmark} ${onBand ? styles.onBand : ''}`;
  const body = (
    <>
      <span
        className={styles.name}
        style={{ ['--wordmark-size' as string]: `${size}px` }}
        aria-label="AgriOne"
        role="img"
      >
        <span aria-hidden>
          Agr<span className={styles.i}>ı</span>
        </span>
        <span className={styles.one} aria-hidden>
          One
        </span>
      </span>
      {tagline ? <span className={styles.tagline}>{taglineText}</span> : null}
    </>
  );
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <span className={className}>{body}</span>
  );
}
