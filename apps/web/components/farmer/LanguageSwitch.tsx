'use client';

import { useFarmerSession } from '@/lib/farmer-session';
import { useArabicEnabled } from '@/lib/settings/client';
import { t, type Language } from '@/lib/i18n';

import styles from './farmer.module.css';

/** English / العربية, two pressed-state buttons. */
export function LanguageButtons({
  value,
  onChange,
  onBand = false,
}: {
  value: Language;
  onChange: (lang: Language) => void;
  /** On a dark green rail: light text, so the unpressed button stays legible. */
  onBand?: boolean;
}) {
  // 2026-10-27: Arabic is offered while Settings say so.
  const arabic = useArabicEnabled();
  return (
    <div
      className={onBand ? `${styles.panelLang} ${styles.panelLangOnBand}` : styles.panelLang}
      role="group"
      aria-label={t('account.language', value)}
    >
      <button
        type="button"
        className={styles.panelLangBtn}
        aria-pressed={value === 'en'}
        onClick={() => onChange('en')}
      >
        {t('language.name', 'en')}
      </button>
      {arabic ? (
        <button
          type="button"
          className={styles.panelLangBtn}
          aria-pressed={value === 'ar'}
          onClick={() => onChange('ar')}
          lang="ar"
          dir="rtl"
        >
          {t('language.arabicNative', 'en')}
        </button>
      ) : null}
    </div>
  );
}

/** The switch bound to the farmer session; the choice persists. */
export function LanguageSwitch() {
  const { language, setLanguage } = useFarmerSession();
  return <LanguageButtons value={language} onChange={setLanguage} />;
}
