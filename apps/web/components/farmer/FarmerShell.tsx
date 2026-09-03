'use client';

import Link from 'next/link';
import { useEffect, type ReactNode } from 'react';

import { useFarmerSession } from '@/lib/farmer-session';
import { htmlLang, isRtl, t } from '@/lib/i18n';

import styles from './farmer.module.css';

/**
 * The farmer flow's frame — deliberately NOT the staff masthead. A small
 * wordmark, one centred column with the Register texture around it, and a
 * "Staff sign in" way back to the portal. When Arabi Juba is chosen it sets the
 * document to `lang="ar" dir="rtl"` so the whole flow mirrors; it restores the
 * document on the way out, so the staff portal is never left in RTL.
 */
export function FarmerShell({ children }: { children: ReactNode }) {
  const { language } = useFarmerSession();
  const rtl = isRtl(language);

  useEffect(() => {
    const root = document.documentElement;
    const prevLang = root.lang;
    const prevDir = root.getAttribute('dir');
    root.lang = htmlLang(language);
    root.dir = rtl ? 'rtl' : 'ltr';
    return () => {
      root.lang = prevLang || 'en';
      if (prevDir) root.setAttribute('dir', prevDir);
      else root.removeAttribute('dir');
    };
  }, [language, rtl]);

  return (
    <div className={styles.scope} dir={rtl ? 'rtl' : 'ltr'}>
      <a href="#farmer-main" className="skip-link">
        Skip to content
      </a>

      <header className={styles.masthead}>
        <div className={styles.mastheadInner}>
          <Link href="/farmer" className={styles.wordmark}>
            <span className={styles.wordmarkOrg}>{t('brand.org', language)}</span>
            <span className={styles.wordmarkName}>{t('brand.tagline', language)}</span>
          </Link>
          <Link href="/" className={styles.staffLink}>
            {t('shell.staffSignIn', language)}
          </Link>
        </div>
      </header>

      <main id="farmer-main" className={styles.main} tabIndex={-1}>
        {children}
      </main>

      <footer className={styles.footer}>
        <span className={styles.footerFlag}>
          <span aria-hidden>● </span>
          {t('shell.previewFlag', language)}
        </span>
        <span>LAST Project · CORWADO</span>
      </footer>
    </div>
  );
}
