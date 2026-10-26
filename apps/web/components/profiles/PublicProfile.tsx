'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { PostKind, PublicExpertise } from '@agri-erp/shared';

import { ABOUT_LABELS } from '@/components/account/AccountActivities';
import { postHref } from '@/components/messages/Messages';
import { EmptyState, Skeleton, Stamp } from '@/components/ui';
import { t, type Language } from '@/lib/i18n';

import { Expertise } from './Expertise';
import styles from './profiles.module.css';

/**
 * A POSTER'S PUBLIC PROFILE (2026-10-20). GET /api/profiles/:kind/:id: the
 * person behind one post on the market -- their market name, place, badge,
 * when they joined, what they do, and everything they have on the market now.
 * Each post links to its own page, where the Message button is.
 *
 * 2026-10-23 (public profiles v2): when the owner has published a public
 * profile, this page hands over to it (/market/p/:publicId).
 */

interface Post {
  id: string;
  title: string;
  line: string;
}

interface Profile {
  /** 2026-10-23: the owner's PUBLISHED public profile, if any. */
  profile_id: string | null;
  name: string;
  verified_organisation: boolean;
  place: { payam: string | null; state: string | null };
  member_since: string;
  about: { profile_kind: string; group_kind: string | null; activities: string[] } | null;
  listings: {
    id: string;
    title: string;
    indicative_price_ssp: number;
    price_per: string;
    location: { payam: string; state: string };
  }[];
  buying_requests: {
    id: string;
    product_name: string;
    quantity: number;
    unit: string;
    location: string;
  }[];
  services: { id: string; title: string; location: string }[];
  /** 2026-10-28: topics of a published advice profile, and the approved-adviser badge. */
  expertise?: PublicExpertise;
}

const W = {
  en: {
    title: 'Profile',
    // 2026-10-31: only organisations are verified.
    verified: 'Verified organisation',
    since: 'Member since',
    listings: 'Selling',
    requests: 'Looking to buy',
    services: 'Services',
    nothing: 'Nothing on the market right now.',
    missing: 'This profile is not available.',
    missingBody: 'The post that led here is no longer on the market.',
    individual: 'Individual',
    business: 'Business',
    institution: 'Institution',
    perUnit: 'per',
  },
  ar: {
    title: 'الملف الشخصي',
    verified: 'منظمة موثّقة',
    since: 'عضو منذ',
    listings: 'يبيع',
    requests: 'يريد أن يشتري',
    services: 'خدمات',
    nothing: 'لا شيء في السوق حالياً.',
    missing: 'هذا الملف غير متاح.',
    missingBody: 'المنشور الذي أوصلك إلى هنا لم يعد في السوق.',
    individual: 'فرد',
    business: 'شركة',
    institution: 'مؤسسة',
    perUnit: 'لكل',
  },
} as const;

export function PublicProfile({
  kind,
  id,
  language,
}: {
  kind: PostKind;
  id: string;
  language: Language;
}) {
  const lang = language === 'ar' ? 'ar' : 'en';
  const w = W[lang];
  const labels = ABOUT_LABELS[lang];
  const [profile, setProfile] = useState<Profile | null | 'missing'>(null);
  const router = useRouter();
  const publishedId = profile && profile !== 'missing' ? profile.profile_id : null;

  useEffect(() => {
    if (publishedId) router.replace(`/market/p/${encodeURIComponent(publishedId)}`);
  }, [publishedId, router]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/profiles/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return ((await r.json()) as { data: Profile }).data;
      })
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch(() => {
        if (!cancelled) setProfile('missing');
      });
    return () => {
      cancelled = true;
    };
  }, [kind, id]);

  if (profile === null || publishedId) {
    return (
      <div className={styles.page} aria-busy>
        <Skeleton width="50%" height={32} />
        <Skeleton height={120} />
      </div>
    );
  }
  if (profile === 'missing') {
    return (
      <div className={styles.page}>
        <EmptyState title={w.missing} body={w.missingBody} />
      </div>
    );
  }

  const place = [profile.place.payam, profile.place.state].filter(Boolean).join(', ');
  const about = profile.about;
  const kindLabel = about
    ? about.profile_kind === 'group'
      ? (labels[about.group_kind ?? ''] ?? null)
      : (w[about.profile_kind as 'individual' | 'business' | 'institution'] ?? null)
    : null;
  const month = new Date(`${profile.member_since}-01T00:00:00Z`).toLocaleDateString(
    lang === 'ar' ? 'ar' : 'en-GB',
    { month: 'long', year: 'numeric', timeZone: 'UTC' },
  );

  const sections: { title: string; kind: PostKind; posts: Post[] }[] = [
    {
      title: w.listings,
      kind: 'listing',
      posts: profile.listings.map((l) => ({
        id: l.id,
        title: l.title,
        line: `SSP ${l.indicative_price_ssp.toLocaleString()} ${w.perUnit} ${l.price_per} · ${l.location.payam}`,
      })),
    },
    {
      title: w.requests,
      kind: 'buying_request',
      posts: profile.buying_requests.map((r) => ({
        id: r.id,
        title: r.product_name,
        line: `${r.quantity.toLocaleString()} ${r.unit} · ${r.location}`,
      })),
    },
    {
      title: w.services,
      kind: 'service',
      posts: profile.services.map((s) => ({ id: s.id, title: s.title, line: s.location })),
    },
  ];
  const anything = sections.some((s) => s.posts.length > 0);

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <span className={styles.eyebrow}>{w.title}</span>
        <h1 dir="auto">{profile.name}</h1>
        <div className={styles.facts}>
          {profile.verified_organisation ? <Stamp kind="verified">{w.verified}</Stamp> : null}
          {place ? <span>{place}</span> : null}
          <span>
            {w.since} {month}
          </span>
        </div>
        {about && (kindLabel || about.activities.length > 0) ? (
          <ul className={styles.chips}>
            {kindLabel ? <li>{kindLabel}</li> : null}
            {about.activities.map((a) => (
              <li key={a}>{labels[a] ?? a}</li>
            ))}
          </ul>
        ) : null}
        <Expertise expertise={profile.expertise} language={lang} />
      </header>

      {anything ? (
        sections
          .filter((s) => s.posts.length > 0)
          .map((s) => (
            <section key={s.kind} className={styles.section}>
              <h2>{s.title}</h2>
              <ul className={styles.posts}>
                {s.posts.map((p) => (
                  <li key={p.id}>
                    <Link href={postHref(s.kind, p.id)} className={styles.post}>
                      <span className={styles.postTitle} dir="auto">
                        {p.title}
                      </span>
                      <span className={styles.postLine} dir="auto">
                        {p.line}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))
      ) : (
        <p className="muted">{w.nothing}</p>
      )}
      <p className="small muted">{t('msg.composeLead', language)}</p>
    </div>
  );
}

/** "See profile" beside a poster's name on a post. */
export function ProfileLink({
  kind,
  id,
  language,
}: {
  kind: PostKind;
  id: string;
  language: Language;
}) {
  return (
    <Link href={`/market/profile/${kind}/${id}`} className={styles.profileLink}>
      {language === 'ar' ? 'عرض الملف الشخصي' : 'See profile'} →
    </Link>
  );
}
