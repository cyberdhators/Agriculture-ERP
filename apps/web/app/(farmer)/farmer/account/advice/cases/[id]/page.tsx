import type { Metadata } from 'next';

import { FarmerAdviceCasePage } from '@/components/advice/Pages';

export const metadata: Metadata = { title: 'Advice request' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FarmerAdviceCasePage id={id} />;
}
