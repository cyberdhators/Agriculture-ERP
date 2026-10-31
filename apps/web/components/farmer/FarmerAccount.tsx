'use client';

import { NotificationPreferencesCard } from '@/components/account/NotificationSettings';
import css from '@/components/account/settings.module.css';
import { farmerPayamName } from '@/lib/fixtures/farmers';
import { useFarmerSession } from '@/lib/farmer-session';
import { useArabicEnabled } from '@/lib/settings/client';
import { t, type Language } from '@/lib/i18n';
import { formatPhone } from '@/lib/format';

import { PageHead } from './AccountShell';
import { RowIcon, SecuritySettings } from './SecuritySettings';

const GLOBE =
  'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-9 9h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z';

/**
 * The Account tab: who you are (name, farmer number, phone, payam) on one
 * card, then Preferences (language), Notifications, Security (password,
 * phone -- which asks for the password, B12 point 2 -- and blocked accounts)
 * and Sign out, as rows.
 *
 * 2026-10-31 (the owner: "the redundant words and style ... elite level ui"):
 * this was a titled card per setting, each title repeated on the button
 * beneath it ("Change password" over "Change password"). Every action is the
 * one it was; only the words and the layout changed.
 */
export function FarmerAccount() {
  const { farmer, language, setLanguage } = useFarmerSession();
  // 2026-10-27: Arabic is offered while Settings say so.
  const arabic = useArabicEnabled();

  if (!farmer) return null;
  const numberPending = farmer.farmer_number.endsWith('-pending');

  function switchLanguage(lang: Language) {
    setLanguage(lang);
  }

  const initials = `${farmer.given_name.charAt(0)}${farmer.family_name.charAt(0)}`.toUpperCase();

  return (
    <>
      <PageHead title={t('account.tabAccount', language)} />

      <div className={css.page}>
        <section className={css.profile} aria-label={t('account.record', language)}>
          <span className={css.avatar} aria-hidden>
            {initials}
          </span>
          <div className={css.profileText}>
            <span className={css.profileName} dir="auto">
              {farmer.given_name} {farmer.family_name}
            </span>
            <span className={css.profileId}>
              {numberPending ? t('account.numberPending', language) : farmer.farmer_number}
            </span>
            <span className={css.profileMeta}>
              {/* A phone number reads left to right in Arabic too. */}
              <span dir="ltr">{formatPhone(farmer.phone)}</span>
              <span>{farmerPayamName(farmer.payam_id)}</span>
            </span>
          </div>
        </section>

        <section className={css.group} aria-labelledby="set-preferences">
          <h2 id="set-preferences" className={css.groupTitle}>
            {t('set.preferences', language)}
          </h2>
          <ul className={css.list}>
            <li className={css.row}>
              <RowIcon d={GLOBE} />
              <span className={css.rowText}>
                <span className={css.rowLabel}>{t('account.changeLanguage', language)}</span>
              </span>
              {arabic ? (
                <span
                  className={css.segmented}
                  role="group"
                  aria-label={t('account.changeLanguage', language)}
                >
                  <button
                    type="button"
                    aria-pressed={language === 'en'}
                    onClick={() => switchLanguage('en')}
                  >
                    {t('language.name', 'en')}
                  </button>
                  <button
                    type="button"
                    aria-pressed={language === 'ar'}
                    onClick={() => switchLanguage('ar')}
                    dir="rtl"
                    lang="ar"
                  >
                    {t('language.arabicNative', 'en')}
                  </button>
                </span>
              ) : (
                <span className={css.rowValue}>{t('language.name', language)}</span>
              )}
            </li>
          </ul>
        </section>

        {/* 2026-10-27: what CORWADO may send, and how. Essential messages have no switch. */}
        <NotificationPreferencesCard language={language} emailAccount={false} />

        <SecuritySettings blocked />
      </div>
    </>
  );
}
