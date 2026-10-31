import type { Language } from '@/lib/i18n';

import css from './welcome.module.css';

/**
 * 2026-10-31 (delight): the first thing a visitor sees on the public market --
 * one line over a light drawing of fields. Signed-in members and staff never
 * see it (StaffMarket decides). Decorative art only; colours are tokens set in
 * welcome.module.css, so it follows dark mode.
 */
export function MarketWelcome({ language }: { language: Language }) {
  return (
    <section className={css.welcome} aria-label={language === 'ar' ? 'مرحبا' : 'Welcome'}>
      <p className={css.welcomeLine} dir="auto">
        {language === 'ar'
          ? 'منتجات طازجة من مزارع جنوب السودان'
          : 'Fresh produce from South Sudanese farms'}
      </p>
      <svg
        className={css.fields}
        viewBox="0 0 320 80"
        preserveAspectRatio="xMaxYMax slice"
        aria-hidden
        focusable="false"
      >
        <circle className={css.sun} cx="258" cy="24" r="11" />
        <path className={css.hillFar} d="M0 58 C 60 36, 120 40, 180 50 S 280 40, 320 44 V80 H0 Z" />
        <path className={css.hillMid} d="M0 66 C 70 50, 150 54, 220 60 S 300 56, 320 58 V80 H0 Z" />
        <path
          className={css.hillNear}
          d="M0 74 C 80 64, 170 66, 240 70 S 300 70, 320 70 V80 H0 Z"
        />
        <g className={css.furrows}>
          <path d="M150 56 C 175 54, 200 56, 225 58" />
          <path d="M140 61 C 170 59, 205 61, 238 63" />
          <path d="M60 70 C 100 66, 150 67, 190 69" />
        </g>
        <g className={css.stalks}>
          <path d="M282 60 V44 M282 50 l-5 -5 M282 47 l5 -5" />
          <path d="M296 60 V46 M296 52 l-5 -5 M296 49 l5 -5" />
          <path d="M268 62 V50 M268 55 l-4 -4 M268 52 l4 -4" />
        </g>
      </svg>
    </section>
  );
}
