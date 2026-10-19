import type { Metadata } from 'next';

import { MarketRequestDetailPage } from '@/components/market-posts/Pages';

export const metadata: Metadata = { title: 'Buying request' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MarketRequestDetailPage id={id} />;
}
