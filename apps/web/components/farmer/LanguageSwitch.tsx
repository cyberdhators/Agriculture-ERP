'use client';

import { useFarmerSession } from '@/lib/farmer-session';
import { t } from '@/lib/i18n';

import styles from './farmer.module.css';

/** English / عربي جوبا, two pressed-state buttons; the choice persists. */
export function LanguageSwitch() {
  const { language, setLanguage } = useFarmerSession();
  return (
    <div className={styles.panelLang} role="group" aria-label={t('account.language', language)}>
      <button
        type="button"
        className={styles.panelLangBtn}
        aria-pressed={language === 'en'}
        onClick={() => setLanguage('en')}
      >
        {t('language.name', 'en')}
      </button>
      <button
        type="button"
        className={styles.panelLangBtn}
        aria-pressed={language === 'ar-juba'}
        onClick={() => setLanguage('ar-juba')}
        lang="ar"
        dir="rtl"
      >
        {t('language.arjubaNative', 'en')}
      </button>
    </div>
  );
}
