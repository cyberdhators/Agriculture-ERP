'use client';

import { useFarmerSession } from '@/lib/farmer-session';
import { LANGUAGE_LABELS } from '@/lib/format';
import { t, type Language } from '@/lib/i18n';

import { PageHead } from './AccountShell';
import styles from './farmer.module.css';

export function FarmerLanguage() {
  const { farmer, language, setLanguage } = useFarmerSession();
  if (!farmer) return null;

  function switchLanguage(lang: Language) {
    setLanguage(lang);
  }

  return (
    <>
      <PageHead
        title={t('account.tileLanguage', language)}
        lead={t('account.tileLanguageSub', language)}
      />

      <div className={styles.settings}>
        <section className={styles.settingCard}>
          <h2>{t('account.changeLanguage', language)}</h2>
          <p className="small muted" style={{ marginBottom: 'var(--s-3)' }}>
            {t('language.subtitle', language)}
          </p>
          <p className="small" style={{ marginBottom: 'var(--s-3)' }}>
            {t('account.tileLanguage', language)}: <strong>{LANGUAGE_LABELS[language]}</strong>
          </p>
          <div className={styles.choiceRow}>
            <button
              type="button"
              className={`${styles.choice} ${language === 'en' ? styles.choiceSelected : ''}`}
              aria-pressed={language === 'en'}
              onClick={() => switchLanguage('en')}
            >
              {t('language.name', language)}
            </button>
            <button
              type="button"
              className={`${styles.choice} ${language === 'ar' ? styles.choiceSelected : ''}`}
              aria-pressed={language === 'ar'}
              onClick={() => switchLanguage('ar')}
              dir="rtl"
              lang="ar"
            >
              {t('language.arabicNative', language)}
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
