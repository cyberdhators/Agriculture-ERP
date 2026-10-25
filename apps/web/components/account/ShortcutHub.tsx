'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { SHORTCUT_HREF, orderShortcuts, type Shortcut } from '@/lib/account/shortcuts';

import styles from '@/components/farmer/farmer.module.css';

type Language = 'en' | 'ar';

const WORDS: Record<Language, Record<Shortcut | 'title' | 'lead', [string, string] | string>> = {
  en: {
    title: 'What would you like to do?',
    lead: 'Every account can do all of these. Your chosen activities only change the order.',
    sell: ['Sell produce', 'Create an offer for buyers'],
    buy: ['Buy', 'Find produce and inputs'],
    buying_request: ['Post a buying request', 'Tell sellers what you need'],
    services: ['Offer services', 'Advertise transport, processing and more'],
    advice: ['Get advice', 'Guidance and advisers'],
    profile: ['My profile', 'Edit, preview and publish'],
    organisations: ['Organisations', 'Act for a group or business'],
  },
  ar: {
    title: 'ماذا تريد أن تفعل؟',
    lead: 'يمكن لكل حساب القيام بكل هذا. أنشطتك المختارة تغيّر الترتيب فقط.',
    sell: ['بيع المنتجات', 'أنشئ عرضاً للمشترين'],
    buy: ['شراء', 'ابحث عن منتجات ومدخلات'],
    buying_request: ['نشر طلب شراء', 'أخبر البائعين بما تحتاج'],
    services: ['تقديم خدمات', 'أعلن عن النقل والتصنيع وغيرها'],
    advice: ['الحصول على نصيحة', 'إرشادات ومستشارون'],
    profile: ['ملفي', 'حرّر واستعرض وانشر'],
    organisations: ['المنظمات', 'تصرّف باسم مجموعة أو شركة'],
  },
};

const GLYPH: Record<Shortcut, React.ReactNode> = {
  sell: <path d="M20 12l-8 8-9-9V3h8zM7.5 7.5h.01" />,
  buy: (
    <>
      <circle cx="9" cy="20" r="1.5" />
      <circle cx="18" cy="20" r="1.5" />
      <path d="M2 3h3l2.5 12h12L22 7H6" />
    </>
  ),
  buying_request: <path d="M6 3h9l4 4v14H6zM9 12h7M9 16h5M14 3v5h5" />,
  services: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" />
    </>
  ),
  advice: (
    <path d="M3 5h7a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H3zM21 5h-7a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h7z" />
  ),
  profile: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </>
  ),
  organisations: <path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-5h6v5M9 11h.01M15 11h.01" />,
};

/**
 * "My AgriOne" (2026-10-28; infographic no. 4): one home with a tile for every
 * ordinary function, on both the phone-account and the email-account home.
 * The account's chosen activities (GET /api/account/profile) order the tiles
 * and hide none (lib/account/shortcuts.ts). Until the answer arrives -- or if
 * it never does -- the default order is shown.
 */
export function ShortcutHub({
  shell,
  language,
}: {
  shell: 'farmer' | 'buyer';
  language: Language;
}) {
  const [activities, setActivities] = useState<string[]>([]);
  useEffect(() => {
    let on = true;
    void fetch('/api/account/profile', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { data?: { activities?: string[] } } | null) => {
        if (on && Array.isArray(b?.data?.activities)) setActivities(b.data.activities);
      })
      .catch(() => undefined);
    return () => {
      on = false;
    };
  }, []);

  const w = WORDS[language];
  const order = orderShortcuts(activities);
  return (
    <section aria-labelledby="shortcut-hub-title" className={styles.block}>
      <div className={styles.blockHead}>
        <h2 id="shortcut-hub-title">{w.title as string}</h2>
      </div>
      <p className="small muted">{w.lead as string}</p>
      <nav className={styles.acctTiles} aria-labelledby="shortcut-hub-title">
        {order.map((s) => {
          const [title, sub] = w[s] as [string, string];
          return (
            <Link key={s} href={SHORTCUT_HREF[shell][s]} className={styles.acctTile}>
              <span className={styles.acctTileGlyph} aria-hidden>
                <svg
                  viewBox="0 0 24 24"
                  width="26"
                  height="26"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                >
                  {GLYPH[s]}
                </svg>
              </span>
              <span className={styles.acctTileText}>
                <span className={styles.acctTileTitle}>{title}</span>
                <span className={styles.acctTileSub}>{sub}</span>
              </span>
            </Link>
          );
        })}
      </nav>
    </section>
  );
}
