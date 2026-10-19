import type { Metadata } from 'next';

import { BuyerBuyingRequestsPage } from '@/components/market-posts/Pages';

export const metadata: Metadata = { title: 'My buying requests' };

export default function Page() {
  return <BuyerBuyingRequestsPage />;
}
