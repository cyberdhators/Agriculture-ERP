import type { Metadata } from 'next';

import { MarketServicesPage } from '@/components/market-posts/Pages';

export const metadata: Metadata = { title: 'Services' };

export default function Page() {
  return <MarketServicesPage />;
}
