import type { Metadata } from 'next';

import { BuyerServiceFormPage } from '@/components/market-posts/Pages';

export const metadata: Metadata = { title: 'Edit service' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BuyerServiceFormPage id={id} />;
}
