import type { Metadata } from 'next';

import { MarketServiceDetailPage } from '@/components/market-posts/Pages';

export const metadata: Metadata = { title: 'Service' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MarketServiceDetailPage id={id} />;
}
