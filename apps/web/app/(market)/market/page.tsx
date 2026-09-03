import type { Metadata } from 'next';

import { MarketPage } from '@/components/market/MarketPages';

export const metadata: Metadata = { title: 'Marketplace' };

export default function Page() {
  return <MarketPage />;
}
