'use client';

import { useEffect, type ReactNode } from 'react';

import { useFarmerSession } from '@/lib/farmer-session';
import { htmlLang, isRtl, t } from '@/lib/i18n';

import styles from './farmer.module.css';

/**
 * The farmer flow's outer scope — deliberately NOT the staff masthead. It
 * bumps the touch target to 48px for every reused control and, when Arabi
 * Juba is chosen, sets the document to `lang="ar" dir="rtl"` so the whole flow
 * mirrors; it restores the document on the way out, so the staff portal is
 * never left in RTL. The two compositions inside it — the entry spread for
 * language / sign in / register, and the ruled account shell — are separate
 * layouts under `app/(farmer)/farmer/`.
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
        {t('shell.skip', language)}
      </a>
      {children}
    </div>
  );
}
