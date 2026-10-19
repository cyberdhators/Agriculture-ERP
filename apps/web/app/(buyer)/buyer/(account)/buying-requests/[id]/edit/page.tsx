import type { Metadata } from 'next';

import { BuyerBuyingRequestFormPage } from '@/components/market-posts/Pages';

export const metadata: Metadata = { title: 'Edit buying request' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BuyerBuyingRequestFormPage id={id} />;
}
