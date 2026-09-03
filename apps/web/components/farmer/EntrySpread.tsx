'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { Wordmark } from '@/components/brand/Wordmark';
import { Boundary } from '@/components/farmers/Boundary';
import { FARMS, type Farm } from '@/lib/fixtures/farmers';
import { useFarmerSession } from '@/lib/farmer-session';
import { t } from '@/lib/i18n';

import { LanguageSwitch } from './LanguageSwitch';
import styles from './farmer.module.css';

/**
 * The composed entry page for language, sign in and register. Above 900px a
 * full-viewport two-panel spread: the forest band as the left panel carrying
 * the wordmark and tagline, one Fraunces statement, a ruled list of what
 * AgriOne does for a farmer, and real plots drawn faint as survey outlines;
 * the form column on the right, vertically centred, with the language switch
 * above and the staff link below. Under 900px the panel gives way to a compact
 * band and the form follows. Panels are a grid in the inline direction, so the
 * order flips with `dir` on its own.
 */

const PLOTS: ReadonlyArray<{ farm: Farm; size: number; x: string; y: string }> = FARMS.filter(
  (f) => f.boundary && f.accuracy_flag !== 'unusable',
)
  .slice(0, 4)
  .map((farm, i) => ({
    farm,
    size: [220, 150, 180, 120][i]!,
    x: ['58%', '72%', '36%', '80%'][i]!,
    y: ['52%', '18%', '70%', '78%'][i]!,
  }));

export function EntryPanel() {
  const { language } = useFarmerSession();
  return (
    <aside className={styles.panel}>
      <div className={styles.panelTop}>
        <Wordmark
          href="/farmer"
          size={26}
          tagline
          onBand
          taglineText={t('brand.tagline', language)}
        />
        <p className={styles.panelStatement}>{t('spread.statement', language)}</p>
        <ol className={styles.panelList}>
          <li>{t('spread.point1', language)}</li>
          <li>{t('spread.point2', language)}</li>
          <li>{t('spread.point3', language)}</li>
          <li>{t('spread.point4', language)}</li>
        </ol>
      </div>

      <div className={styles.plots} aria-hidden>
        {PLOTS.map((p) => (
          <div
            key={p.farm.id}
            className={styles.plot}
            style={{ insetInlineStart: p.x, insetBlockStart: p.y }}
          >
            <Boundary farm={p.farm} size={p.size} showArea={false} />
          </div>
        ))}
      </div>

      <div className={styles.panelFoot}>
        <span>{t('brand.copyright', language)}</span>
        <Link href="/market" className={styles.mastLink}>
          {t('shell.marketplace', language)}
        </Link>
      </div>
    </aside>
  );
}

export function EntrySpread({ children }: { children: ReactNode }) {
  const { language } = useFarmerSession();
  return (
    <div className={styles.spread}>
      <EntryPanel />
      <div className={styles.spreadColumn}>
        <div className={styles.compactBand}>
          <Wordmark href="/farmer" size={22} onBand />
          <LanguageSwitch />
        </div>
        <main id="farmer-main" className={styles.spreadForm} tabIndex={-1}>
          {children}
        </main>
        <footer className={styles.spreadFooter}>
          <LanguageSwitch />
          <Link href="/dashboard" className={styles.staffLink}>
            {t('shell.staffSignIn', language)}
          </Link>
        </footer>
      </div>
    </div>
  );
}
