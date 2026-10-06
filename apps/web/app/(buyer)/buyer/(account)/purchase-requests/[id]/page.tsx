import type { Metadata } from 'next';

import { BuyerRequestDetail } from '@/components/buyer/BuyerRequestDetail';

export const metadata: Metadata = { title: 'Purchase request' };

export default async function BuyerRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BuyerRequestDetail id={id} />;
}
