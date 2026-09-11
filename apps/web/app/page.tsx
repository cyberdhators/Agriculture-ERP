import Link from 'next/link';

import styles from './page.module.css';

export default function Home() {
  return (
    <main className={styles.landing}>
      <div className={styles.panel}>
        <div className={styles.wordmark}>
          <span className={styles.tile} aria-hidden>
            A
          </span>
          <div>
            <h1>Agriculture ERP</h1>
            <p className="muted">LAST Project · CORWADO · Central Equatoria</p>
          </div>
        </div>
        <p>
          Web portal for programme staff. Sign-in arrives with unit B3; until then the portal opens
          directly and shows fixture data.
        </p>
        <nav className={styles.links} aria-label="Portal sections">
          <Link href="/directories" className={styles.link}>
            Directories <span>agro-dealers, input suppliers, financial services</span>
          </Link>
          <Link href="/library" className={styles.link}>
            Learning library <span>guides, audio and video for officers</span>
          </Link>
          <Link href="/design" className={styles.link}>
            Design system <span>tokens, components and rules</span>
          </Link>
        </nav>
      </div>
    </main>
  );
}
