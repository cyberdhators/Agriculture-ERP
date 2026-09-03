'use client';

import { useFarmerSession } from '@/lib/farmer-session';
import { t, type Language } from '@/lib/i18n';

import styles from './farmer.module.css';

/** English / عربي جوبا, two pressed-state buttons. */
export function LanguageButtons({
  value,
  onChange,
}: {
  value: Language;
  onChange: (lang: Language) => void;
}) {
  return (
    <div className={styles.panelLang} role="group" aria-label={t('account.language', value)}>
      <button
        type="button"
        className={styles.panelLangBtn}
        aria-pressed={value === 'en'}
        onClick={() => onChange('en')}
      >
        {t('language.name', 'en')}
      </button>
      <button
        type="button"
        className={styles.panelLangBtn}
        aria-pressed={value === 'ar-juba'}
        onClick={() => onChange('ar-juba')}
        lang="ar"
        dir="rtl"
      >
        {t('language.arjubaNative', 'en')}
      </button>
    </div>
  );
}

/** The switch bound to the farmer session; the choice persists. */
export function LanguageSwitch() {
  const { language, setLanguage } = useFarmerSession();
  return <LanguageButtons value={language} onChange={setLanguage} />;
}
