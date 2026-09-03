import type { Metadata } from 'next';
import { Fraunces, Instrument_Sans, JetBrains_Mono } from 'next/font/google';
import type { ReactNode } from 'react';

import './globals.css';

/**
 * The Register's three voices, loaded once and exposed as CSS variables on
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
    default: 'CORWADO · Agricultural Register',
    template: '%s · Agricultural Register',
  },
  description:
    'The working register of a farming economy — farmers, fields, crops and cooperatives across Central Equatoria. CORWADO, LAST Project.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${instrument.variable} ${jetbrains.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
