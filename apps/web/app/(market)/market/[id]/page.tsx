import type { Metadata } from 'next';

import { MarketDetailPage } from '@/components/market/MarketPages';

export const metadata: Metadata = { title: 'Listing' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MarketDetailPage id={id} />;
}
