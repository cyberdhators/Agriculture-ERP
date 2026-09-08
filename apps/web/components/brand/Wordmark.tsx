import Link from 'next/link';

import styles from './brand.module.css';

/**
 * The AgriOne brand lockup: the logo image. On the forest band (`onBand`) it
 * sits in a white chip so the dark-green wordmark stays legible; on light
 * surfaces it renders plain. `size` sets its height in px. The optional
 * `tagline`/`taglineText` props are kept for call-site compatibility; the
 * tagline is part of the logo art, so they are no longer rendered separately.
 */
export function Wordmark({
  size = 22,
  onBand = false,
  href,
}: {
  size?: number;
  tagline?: boolean;
  onBand?: boolean;
  href?: string;
  taglineText?: string;
}) {
  const className = `${styles.wordmark} ${onBand ? styles.onBand : ''}`;
  const body = (
    <img
      src="/brand/agrione-logo.png"
      alt="AgriOne — Digital Agriculture Marketplace"
      className={styles.logo}
      style={{ height: `${Math.round(size * 1.7)}px` }}
    />
  );
  return href ? (
    <Link href={href} className={className} aria-label="AgriOne">
      {body}
    </Link>
  ) : (
    <span className={className}>{body}</span>
  );
}
