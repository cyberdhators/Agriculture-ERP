import type { Metadata } from 'next';

import { BuyerBuyingRequestFormPage } from '@/components/market-posts/Pages';

export const metadata: Metadata = { title: 'New buying request' };

export default function Page() {
  return <BuyerBuyingRequestFormPage />;
}
