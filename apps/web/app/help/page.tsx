import type { Metadata } from 'next';

import { HelpPage } from '@/components/support/HelpPage';

export const metadata: Metadata = { title: 'Help' };

/** /help -- "Contact CORWADO" (2026-10-21). Public: anyone may ask for help. */
export default function HelpRoute() {
  return <HelpPage />;
}
