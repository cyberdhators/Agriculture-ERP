import type { Metadata } from 'next';
import { Fraunces, Instrument_Sans, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';

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

export const metadata: Metadata = {
  title: {
    default: 'AgriOne',
    template: '%s · AgriOne',
  },
  description:
    'AgriOne — Digital Agriculture & Agribusiness Ecosystem. Farmers, farms, produce and the marketplace that joins them.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${instrument.variable} ${jetbrains.variable}`}>
      <body>{children}</body>
    </html>
  );
}
