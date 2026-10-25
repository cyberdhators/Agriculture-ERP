import type { Metadata } from 'next';

import { BuyerAdviceCase } from '@/components/buyer/BuyerPages';

export const metadata: Metadata = { title: 'Advice request' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BuyerAdviceCase id={id} />;
}
