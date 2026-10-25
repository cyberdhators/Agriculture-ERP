import type { Metadata } from 'next';

import { BuyerAdviceOffer } from '@/components/buyer/BuyerPages';

export const metadata: Metadata = { title: 'Offer advice' };

export default function Page() {
  return <BuyerAdviceOffer />;
}
