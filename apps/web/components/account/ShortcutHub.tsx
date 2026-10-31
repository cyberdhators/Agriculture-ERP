'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { SHORTCUT_HREF, orderShortcuts, type Shortcut } from '@/lib/account/shortcuts';

import styles from '@/components/farmer/farmer.module.css';

type Language = 'en' | 'ar';

const WORDS: Record<Language, Record<Shortcut | 'title', [string, string] | string>> = {
  en: {
    title: 'What would you like to do?',
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
    sell: ['بيع المنتجات', 'أنشئ عرضاً للمشترين'],
    buy: ['شراء', 'ابحث عن منتجات ومدخلات'],
    buying_request: ['نشر طلب شراء', 'أخبر البائعين بما تحتاج'],
    services: ['تقديم خدمات', 'أعلن عن النقل والتصنيع وغيرها'],
    advice: ['الحصول على نصيحة', 'إرشادات ومستشارون'],
    profile: ['ملفي', 'حرّر واستعرض وانشر'],
    organisations: ['المنظمات', 'تصرّف باسم مجموعة أو شركة'],
  },
};

/** One word under each round icon. */
const SHORT: Record<Language, Record<Shortcut, string>> = {
  en: {
    sell: 'Sell',
    buy: 'Buy',
    buying_request: 'Request',
    services: 'Services',
    advice: 'Advice',
    profile: 'Profile',
    organisations: 'Groups',
  },
  ar: {
    sell: 'بيع',
    buy: 'شراء',
    buying_request: 'طلب',
    services: 'خدمات',
    advice: 'نصيحة',
    profile: 'ملفي',
    organisations: 'منظمات',
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
  // 2026-10-31: a building, not a house -- the house is "Your farm" on the
  // same home, and two house tiles read as a duplicate on a phone.
  organisations: (
    <path d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16M16 9h3a1 1 0 0 1 1 1v11M2 21h20M8 7h4M8 11h4M8 15h4" />
  ),
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
  // 2026-10-31 (the owner: "creatively beautiful", no big bold words): the
  // seven ways in as a row of round icons with one word each, like a phone's
  // own quick actions; the full name is the link's accessible name.
  return (
    <section aria-labelledby="shortcut-hub-title" className={styles.quickWrap}>
      <h2 id="shortcut-hub-title" className="visually-hidden">
        {w.title as string}
      </h2>
      <nav className={styles.quick} aria-labelledby="shortcut-hub-title">
        {order.map((s) => {
          const [title] = w[s] as [string, string];
          return (
            <Link
              key={s}
              href={SHORTCUT_HREF[shell][s]}
              className={styles.quickItem}
              aria-label={title}
            >
              <span className={styles.quickIcon} aria-hidden>
                <svg
                  viewBox="0 0 24 24"
                  width="24"
                  height="24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {GLYPH[s]}
                </svg>
              </span>
              <span className={styles.quickLabel} aria-hidden>
                {SHORT[language][s]}
              </span>
            </Link>
          );
        })}
      </nav>
    </section>
  );
}
