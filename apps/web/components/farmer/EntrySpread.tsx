'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { Wordmark } from '@/components/brand/Wordmark';
import { useFarmerSession } from '@/lib/farmer-session';
import { t } from '@/lib/i18n';

import { LanguageSwitch } from './LanguageSwitch';
import styles from './farmer.module.css';

/**
 * The public entry, composed as a shop sign-in: the AgriOne wordmark and
 * tagline centred at the top, the sign-in (or register) form in a single
 * white card on the shop's grey ground, and a quiet footer carrying the
 * marketplace and staff links. The card is capped narrow and stays centred at
 * every width, so there is no empty panel on a wide screen. The language
 * switch sits above the card; order and mirroring follow `dir` on their own.
 */
export function EntrySpread({ children }: { children: ReactNode }) {
  const { language } = useFarmerSession();
  return (
    <div className={styles.entryPage}>
      <header className={styles.entryHead}>
        <Wordmark href="/farmer" size={44} />
        <div className={styles.entryLang}>
          <LanguageSwitch />
        </div>
      </header>

      <main id="farmer-main" className={styles.entryMain} tabIndex={-1}>
        <div className={styles.signCard}>{children}</div>
        <p className={styles.entryBrowse}>
          <Link href="/market" className={styles.entryBrowseLink}>
            {t('shell.marketplace', language)}
          </Link>
        </p>
      </main>

      <footer className={styles.entryFoot}>
        <span>{t('brand.copyright', language)}</span>
        <Link href="/dashboard" className={styles.staffLink}>
          {t('shell.staffSignIn', language)}
        </Link>
      </footer>
    </div>
  );
}
