import type { Metadata } from 'next';

import { BuyerProductDetail } from '@/components/buyer/BuyerProductDetail';

export const metadata: Metadata = { title: 'Product' };

export default async function BuyerProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BuyerProductDetail id={id} />;
}
