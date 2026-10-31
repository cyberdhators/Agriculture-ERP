'use client';

import css from '@/components/account/settings.module.css';
import { useFarmerSession } from '@/lib/farmer-session';
import { useArabicEnabled } from '@/lib/settings/client';
import { t, type Language } from '@/lib/i18n';

import { PageHead } from './AccountShell';

const CHECK = (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="m5 12 5 5 9-10" />
  </svg>
);

/**
 * Language: the choices as a list, the current one ticked (2026-10-31). It
 * was the word "Language" four times -- page title, lead, card title and
 * "Language: English" -- above two buttons.
 */
export function FarmerLanguage() {
  const { farmer, language, setLanguage } = useFarmerSession();
  // 2026-10-27: Arabic is offered while Settings say so.
  const arabic = useArabicEnabled();
  if (!farmer) return null;

  const choices: { lang: Language; label: string; rtl?: boolean }[] = [
    { lang: 'en', label: t('language.name', 'en') },
    ...(arabic
      ? [{ lang: 'ar' as Language, label: t('language.arabicNative', 'en'), rtl: true }]
      : []),
  ];

  return (
    <>
      <PageHead title={t('account.tileLanguage', language)} />
      <div className={css.page}>
        <ul className={css.list} role="radiogroup" aria-label={t('account.tileLanguage', language)}>
          {choices.map((c) => (
            <li key={c.lang}>
              <button
                type="button"
                role="radio"
                aria-checked={language === c.lang}
                className={`${css.row} ${css.rowButton}`}
                onClick={() => setLanguage(c.lang)}
              >
                <span className={css.rowText}>
                  <span
                    className={css.rowLabel}
                    lang={c.rtl ? 'ar' : 'en'}
                    dir={c.rtl ? 'rtl' : 'ltr'}
                  >
                    {c.label}
                  </span>
                </span>
                {language === c.lang ? <span className={css.tick}>{CHECK}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
