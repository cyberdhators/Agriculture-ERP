import type { Metadata } from 'next';

import { BuyerAdviceProvider } from '@/components/buyer/BuyerPages';

export const metadata: Metadata = { title: 'Adviser' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BuyerAdviceProvider id={id} />;
}
