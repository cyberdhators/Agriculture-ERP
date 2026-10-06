import type { Metadata } from 'next';

import { BuyerOrderDetail } from '@/components/buyer/BuyerOrderDetail';

export const metadata: Metadata = { title: 'Order' };

export default async function BuyerOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BuyerOrderDetail id={id} />;
}
