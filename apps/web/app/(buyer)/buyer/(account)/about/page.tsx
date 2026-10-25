import type { Metadata } from 'next';

import { BuyerAbout } from '@/components/buyer/BuyerPages';

export const metadata: Metadata = { title: 'About you' };

export default function BuyerAboutPage() {
  return <BuyerAbout />;
}
