import type { Metadata } from 'next';

import { Market } from '@/components/market/Market';

export const metadata: Metadata = { title: 'Market' };

export default function MarketPage() {
  return <Market />;
}
