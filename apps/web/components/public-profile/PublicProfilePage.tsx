'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import type { PostKind, PublicProfileView } from '@agri-erp/shared';

import { ReportPost } from '@/components/market-posts/ContactAndReport';
import { MessageButton } from '@/components/messages/MessageButton';
import { postHref } from '@/components/messages/Messages';
import { Button, EmptyState, Skeleton, Tabs } from '@/components/ui';
import { useFarmerSession } from '@/lib/farmer-session';
import { t, type Language } from '@/lib/i18n';
import { getPublicProfile } from '@/lib/public-profile/client';

import { ProfileCard } from './ProfileCard';
import styles from './public-profile.module.css';

/**
 * /market/p/:publicId -- a PUBLISHED public profile (2026-10-23, public
 * profiles v2), as the client's infographic draws it: photo or initials,
 * name, what they do, place, about, the Verified badge, a Message button,
 * tabs for Overview / Offers / Buying requests / Services, and "Report
 * profile". Only what the owner chose to publish; never login information.
 *
 * MESSAGES ARE ALWAYS ABOUT A POST (the owner's rule for messaging), so
 * "Message" first asks which of their posts it is about, then opens the usual
 * message box for that post. No posts on the market, or messaging turned off:
 * no Message button.
 */

interface Post {
  kind: PostKind;
  id: string;
  title: string;
  line: string;
}

interface ListingShape {
  id: string;
  title: string;
  indicative_price_ssp: number;
  price_per: string;
  location: { payam: string; state: string };
}
interface RequestShape {
  id: string;
  product_name: string;
  quantity: number;
  unit: string;
  location: string;
}
interface ServiceShape {
  id: string;
  title: string;
  location: string;
}

type Tab = 'overview' | 'offers' | 'requests' | 'services';

function postsOf(profile: PublicProfileView, language: Language) {
  const offers: Post[] = (profile.listings as ListingShape[]).map((l) => ({
    kind: 'listing',
    id: l.id,
    title: l.title,
    line: `SSP ${l.indicative_price_ssp.toLocaleString()} ${t('pp.perUnit', language)} ${l.price_per} · ${l.location.payam}`,
  }));
  const requests: Post[] = (profile.buying_requests as RequestShape[]).map((r) => ({
    kind: 'buying_request',
    id: r.id,
    title: r.product_name,
    line: `${r.quantity.toLocaleString()} ${r.unit} · ${r.location}`,
  }));
  const services: Post[] = (profile.service_listings as ServiceShape[]).map((s) => ({
    kind: 'service',
    id: s.id,
    title: s.title,
    line: s.location,
  }));
  return { offers, requests, services };
}

function PostList({ posts, language }: { posts: Post[]; language: Language }) {
  if (posts.length === 0) return <p className="muted">{t('pp.nothing', language)}</p>;
  return (
    <ul className={styles.posts}>
      {posts.map((p) => (
        <li key={`${p.kind}:${p.id}`}>
          <Link href={postHref(p.kind, p.id)} className={styles.post}>
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
  );
}

/** "Message": choose the post first, then the usual message box for it. */
function MessageChooser({ posts, language }: { posts: Post[]; language: Language }) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Post | null>(null);
  if (posts.length === 0) return null;
  if (chosen) {
    return (
      <MessageButton postKind={chosen.kind} postId={chosen.id} language={language} initiallyOpen />
    );
  }
  if (!open) {
    return (
      <div className={styles.actions}>
        <Button onClick={() => (posts.length === 1 ? setChosen(posts[0]!) : setOpen(true))}>
          {t('pp.message', language)}
        </Button>
      </div>
    );
  }
  return (
    <div className={styles.chooser}>
      <p className="small">{t('pp.messageChoose', language)}</p>
      {posts.map((p) => (
        <button
          key={`${p.kind}:${p.id}`}
          type="button"
          className={styles.choice}
          onClick={() => setChosen(p)}
        >
          <span className={styles.postTitle} dir="auto">
            {p.title}
          </span>{' '}
          <span className={styles.postLine} dir="auto">
            {p.line}
          </span>
        </button>
      ))}
      <div>
        <Button variant="ghost" size="small" onClick={() => setOpen(false)}>
          {t('msg.cancel', language)}
        </Button>
      </div>
    </div>
  );
}

export function PublicProfileBody({
  profile,
  language,
}: {
  profile: PublicProfileView;
  language: Language;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const { offers, requests, services } = postsOf(profile, language);
  const all = [...offers, ...requests, ...services];
  const featured = all.slice(0, 3);

  return (
    <div className={styles.page}>
      <ProfileCard
        language={language}
        profile={{
          display_name: profile.display_name,
          photo_url: profile.photo_url,
          activities: profile.activities,
          location: profile.location,
          about: profile.about,
          products: profile.products,
          services: profile.services,
          verified: profile.verified,
          member_since: profile.member_since,
        }}
      >
        {profile.phone ? (
          <div className={styles.contact}>
            <span className="small muted">{t('pp.phone', language)}</span>
            <a className={styles.phone} href={`tel:${profile.phone}`}>
              {profile.phone}
            </a>
          </div>
        ) : profile.phone_on_sign_in ? (
          <p className="small muted">{t('pp.phoneSignIn', language)}</p>
        ) : null}
        {profile.can_message ? <MessageChooser posts={all} language={language} /> : null}
      </ProfileCard>

      <Tabs<Tab>
        label={profile.display_name}
        value={tab}
        onChange={setTab}
        items={[
          { key: 'overview', label: t('pp.tab.overview', language) },
          { key: 'offers', label: t('pp.tab.offers', language), count: offers.length },
          { key: 'requests', label: t('pp.tab.requests', language), count: requests.length },
          { key: 'services', label: t('pp.tab.services', language), count: services.length },
        ]}
      />
      <section className={styles.section}>
        {tab === 'overview' ? (
          <>
            <h2>{t('pp.featured', language)}</h2>
            <PostList posts={featured} language={language} />
          </>
        ) : (
          <PostList
            posts={tab === 'offers' ? offers : tab === 'requests' ? requests : services}
            language={language}
          />
        )}
      </section>

      <div>
        <ReportPost
          kind="profiles/p"
          id={profile.public_id}
          lang={language}
          label={t('pp.report', language)}
        />
      </div>
      <p className="small muted">{t('pp.notEndorsement', language)}</p>
    </div>
  );
}

/** The page: loads the profile, in the farmer's language when one is signed in. */
export function PublicProfilePage({ publicId }: { publicId: string }) {
  const { language } = useFarmerSession();
  const [profile, setProfile] = useState<PublicProfileView | null | 'missing'>(null);

  useEffect(() => {
    let cancelled = false;
    getPublicProfile(publicId)
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch(() => {
        if (!cancelled) setProfile('missing');
      });
    return () => {
      cancelled = true;
    };
  }, [publicId]);

  if (profile === null) {
    return (
      <div className={styles.page} aria-busy>
        <Skeleton height={140} />
        <Skeleton height={80} />
      </div>
    );
  }
  if (profile === 'missing') {
    return (
      <div className={styles.page}>
        <EmptyState title={t('pp.missing', language)} body={t('pp.missingBody', language)} />
      </div>
    );
  }
  return <PublicProfileBody profile={profile} language={language} />;
}
