'use client';

import type { ReactNode } from 'react';

import type { RatingSummary } from '@agri-erp/shared';

import { ABOUT_LABELS } from '@/components/account/AccountActivities';
import { VerifiedOrganisationBadge } from '@/components/listings/VerifiedOrganisationBadge';
import { RatingMark } from '@/components/ratings/Ratings';
import { t, type Language } from '@/lib/i18n';
import { initialsOf } from '@/lib/public-profile/client';

import styles from './public-profile.module.css';

/**
 * THE PUBLIC FACE OF A PROFILE (2026-10-23): photo or initials, name, what
 * they do, general location, badge, about, products and services. Shown on
 * the public page and, from the owner's own data, as the editor's preview --
 * one component, so the preview is exactly what others will see.
 */
export interface ProfileCardData {
  display_name: string;
  photo_url: string | null;
  activities: readonly string[];
  location: { state: string | null; payam: string | null };
  about: string | null;
  products: readonly string[];
  services: readonly string[];
  verified_organisation: boolean;
  member_since: string | null;
  /** 2026-10-31 (delight): the ratings summary, when the page has it -- shown as "★ 4.6 · 12". */
  ratings?: RatingSummary;
}

export function ProfilePhoto({
  name,
  url,
  small = false,
}: {
  name: string;
  url: string | null;
  small?: boolean;
}) {
  return (
    <span className={small ? styles.small : undefined}>
      {url ? (
        // A short-lived signed link from private storage, so a plain img, not next/image.
        <img className={styles.photo} src={url} alt="" />
      ) : (
        <span className={styles.initials} aria-hidden>
          {initialsOf(name)}
        </span>
      )}
    </span>
  );
}

export function ProfileCard({
  profile,
  language,
  heading = 'h1',
  children,
}: {
  profile: ProfileCardData;
  language: Language;
  heading?: 'h1' | 'h2';
  /** The Message button and phone, under the about text. */
  children?: ReactNode;
}) {
  const lang = language === 'ar' ? 'ar' : 'en';
  const labels = ABOUT_LABELS[lang];
  const place = [profile.location.payam, profile.location.state].filter(Boolean).join(', ');
  const roles = profile.activities.map((a) => labels[a] ?? a).join(' • ');
  const month = profile.member_since
    ? new Date(`${profile.member_since}-01T00:00:00Z`).toLocaleDateString(
        lang === 'ar' ? 'ar' : 'en-GB',
        { month: 'long', year: 'numeric', timeZone: 'UTC' },
      )
    : null;
  const Heading = heading;

  return (
    <section className={styles.card}>
      <ProfilePhoto name={profile.display_name} url={profile.photo_url} />
      <div className={styles.who}>
        <Heading dir="auto">{profile.display_name}</Heading>
        {roles ? <p className={styles.roles}>{roles}</p> : null}
        <div className={styles.facts}>
          {/* 2026-10-31 (delight): the tick and the stars as marks, not plain text. */}
          <VerifiedOrganisationBadge verified={profile.verified_organisation} lang={language} />
          <RatingMark summary={profile.ratings} language={language} />
          {place ? <span dir="auto">{place}</span> : null}
          {month ? (
            <span>
              {t('pp.since', language)} {month}
            </span>
          ) : null}
        </div>
        {profile.about ? (
          <p className={styles.about} dir="auto">
            {profile.about}
          </p>
        ) : null}
        {profile.products.length > 0 ? (
          <div>
            <span className="small muted">{t('pp.products', language)}</span>
            <ul className={styles.tags}>
              {profile.products.map((p) => (
                <li key={p} dir="auto">
                  {p}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {profile.services.length > 0 ? (
          <div>
            <span className="small muted">{t('pp.services', language)}</span>
            <ul className={styles.tags}>
              {profile.services.map((s) => (
                <li key={s} dir="auto">
                  {s}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {children}
      </div>
    </section>
  );
}
