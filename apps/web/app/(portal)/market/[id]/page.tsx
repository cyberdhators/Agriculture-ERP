import type { Metadata } from 'next';

import { StaffMarketDetail } from '@/components/market/StaffMarket';

export const metadata: Metadata = { title: 'Listing' };

export default async function MarketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StaffMarketDetail id={id} />;
}
