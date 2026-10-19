'use client';

import Link from 'next/link';

import { t, type Language } from '@/lib/i18n';

import styles from './market-posts.module.css';

export type MarketSection = 'produce' | 'requests' | 'services';

const SECTIONS: ReadonlyArray<{ key: MarketSection; href: string }> = [
  { key: 'produce', href: '/market' },
  { key: 'requests', href: '/market/requests' },
  { key: 'services', href: '/market/services' },
];

const LABEL = {
  produce: 'marketSections.produce',
  requests: 'marketSections.requests',
  services: 'marketSections.services',
} as const;

/**
 * LISTINGS LANE (2026-10-19). The three parts of the public market: produce
 * for sale, buying requests ("I need X"), and services for hire. A row of
 * links that scrolls sideways on a 360px phone rather than wrapping.
 */
export function MarketSections({ current, lang }: { current: MarketSection; lang: Language }) {
  return (
    <nav className={styles.sections} aria-label={t('marketSections.label', lang)}>
      {SECTIONS.map((s) => (
        <Link key={s.key} href={s.href} aria-current={s.key === current ? 'page' : undefined}>
          {t(LABEL[s.key], lang)}
        </Link>
      ))}
    </nav>
  );
}
