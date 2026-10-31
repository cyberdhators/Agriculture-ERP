import type { Metadata, Viewport } from 'next';
import {
  Fraunces,
  Instrument_Sans,
  JetBrains_Mono,
  Noto_Sans_Arabic,
  Open_Sans,
} from 'next/font/google';
import type { ReactNode } from 'react';

import { OfflineSync } from '@/components/pwa/OfflineSync';
import { PwaStatus } from '@/components/pwa/PwaStatus';
import { MaintenanceBanner } from '@/components/site/MaintenanceBanner';

import './globals.css';

/**
 * AgriOne's three voices, loaded once and exposed as CSS variables on
 * <html>: Fraunces for display (optical size, soft terminals), Instrument Sans
 * for the interface, JetBrains Mono for every id, code, date and figure.
 */
const fraunces = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  axes: ['opsz', 'SOFT', 'WONK'],
  variable: '--font-fraunces',
});

const instrument = Instrument_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-instrument',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains',
});

/**
 * Open Sans is the farmer + marketplace UI face — a free humanist sans standing
 * in for Amazon Ember on the shopping surfaces only. It reaches the document as
 * --font-open-sans and is applied inside the `.shop` scope; the staff portal
 * keeps Fraunces / Instrument Sans / JetBrains Mono untouched.
 */
const openSans = Open_Sans({
  subsets: ['latin'],
  display: 'swap',
  weight: ['400', '600', '700'],
  variable: '--font-open-sans',
});

/**
 * 2026-10-31: one Arabic face for every Arabic letter. None of the faces above
 * carries Arabic, so each browser fell back to whatever it had -- thin serif
 * headings beside bold sans text. The arabic subset ships with a unicode-range,
 * so it is fetched only when Arabic is on screen (hence no preload).
 */
const arabic = Noto_Sans_Arabic({
  subsets: ['arabic'],
  display: 'swap',
  weight: ['400', '600', '700'],
  preload: false,
  variable: '--font-arabic',
});

export const metadata: Metadata = {
  title: {
    default: 'AgriOne South Sudan',
    template: '%s · AgriOne South Sudan',
  },
  description:
    'AgriOne South Sudan: Digital Agriculture & Agribusiness Ecosystem. Farmers, farms, produce and the marketplace that joins them.',
  // PWA (2026-10-10): installable on Android, with its own icon and name.
  // Android only (the owner): no iPhone-specific settings.
  applicationName: 'AgriOne',
  icons: {
    icon: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // 2026-10-31: the phone's top bar follows the theme (the band colour in
  // each), so the installed app's frame matches the page.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0f2e1c' },
    { media: '(prefers-color-scheme: dark)', color: '#0a1f13' },
  ],
};

const THEME_SCRIPT = `try{var d=document.documentElement,t=localStorage.getItem('agri-theme');if(t==='dark'||t==='light')d.setAttribute('data-theme',t);if(localStorage.getItem('agri-text')==='large')d.setAttribute('data-text','large')}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${instrument.variable} ${jetbrains.variable} ${openSans.variable} ${arabic.variable}`}
      // The theme attribute is set by the script below before React loads.
      suppressHydrationWarning
    >
      <head>
        {/* 2026-10-31, dark mode: apply the member's Appearance choice
            (Account > Appearance, kept on this phone) before the first paint,
            so a dark choice never flashes white. No choice = follow the phone. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        {/* 2026-10-25: the maintenance notice, when switched on in Settings. */}
        <MaintenanceBanner />
        {children}
        <PwaStatus />
        <OfflineSync />
      </body>
    </html>
  );
}
