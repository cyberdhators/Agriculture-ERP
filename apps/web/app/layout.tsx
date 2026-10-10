import type { Metadata, Viewport } from 'next';
import { Fraunces, Instrument_Sans, JetBrains_Mono, Open_Sans } from 'next/font/google';
import type { ReactNode } from 'react';

import { PwaStatus } from '@/components/pwa/PwaStatus';

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
  themeColor: '#0f2e1c',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${instrument.variable} ${jetbrains.variable} ${openSans.variable}`}
    >
      <body>
        {children}
        <PwaStatus />
      </body>
    </html>
  );
}
