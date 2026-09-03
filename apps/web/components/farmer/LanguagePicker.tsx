'use client';

import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui';
import { IconCheck } from '@/components/ui/icons';
import { useFarmerSession } from '@/lib/farmer-session';
import { t, type Language } from '@/lib/i18n';

import styles from './farmer.module.css';

/**
 * The first screen: choose English or Arabi Juba. Both choices are shown in
 * their own name (the Arabic script "عربي جوبا" with the Latin "Arabi Juba"
 * beneath, supplied verbatim by CORWADO). The choice is persisted and every
 * later screen renders in it; a "Staff sign in" link back to the portal lives
 * in the shell above.
 */
export function LanguagePicker() {
  const { language, setLanguage } = useFarmerSession();
  const router = useRouter();

  function choose(lang: Language) {
    setLanguage(lang);
  }

  return (
    <div className={styles.sheet}>
      <p className={styles.eyebrow}>{t('brand.tagline', language)}</p>
      <h1 className={styles.h1}>{t('language.title', language)}</h1>
      <p className={styles.lede}>{t('language.subtitle', language)}</p>

      <div className={styles.tiles} role="radiogroup" aria-label={t('language.title', language)}>
        <button
          type="button"
          role="radio"
          aria-checked={language === 'en'}
          className={`${styles.tile} ${language === 'en' ? styles.tileSelected : ''}`}
          onClick={() => choose('en')}
        >
          <span>{t('language.name', language)}</span>
          {language === 'en' ? <IconCheck size={22} className={styles.tileCheck} /> : null}
        </button>

        <button
          type="button"
          role="radio"
          aria-checked={language === 'ar-juba'}
          className={`${styles.tile} ${language === 'ar-juba' ? styles.tileSelected : ''}`}
          onClick={() => choose('ar-juba')}
          dir="rtl"
          lang="ar"
        >
          <span>
            <span className={styles.tileNative}>{t('language.arjubaNative', language)}</span>
            <span className={styles.tileLatin} dir="ltr">
              {t('language.arjubaName', 'en')}
            </span>
          </span>
          {language === 'ar-juba' ? <IconCheck size={22} className={styles.tileCheck} /> : null}
        </button>
      </div>

      <div className={styles.actions}>
        <Button
          variant="primary"
          className={styles.blockButton}
          onClick={() => router.push('/farmer/login')}
        >
          {t('language.continue', language)}
        </Button>
      </div>
    </div>
  );
}
