import type { Metadata } from 'next';

import { MarketRequestsPage } from '@/components/market-posts/Pages';

export const metadata: Metadata = { title: 'Buying requests' };

export default function Page() {
  return <MarketRequestsPage />;
}
