import type { Metadata } from 'next';

import { StaffMarket } from '@/components/market/StaffMarket';

export const metadata: Metadata = { title: 'Marketplace' };

export default function MarketPage() {
  return <StaffMarket />;
}
