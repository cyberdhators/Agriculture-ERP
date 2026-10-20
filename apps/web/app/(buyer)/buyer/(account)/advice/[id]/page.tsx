import type { Metadata } from 'next';

import { ProviderDetail } from '@/components/advice/ProviderDetail';
import { BUYER_ADVICE } from '@/lib/advice/labels';

export const metadata: Metadata = { title: 'Adviser' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProviderDetail id={id} lang="en" base={BUYER_ADVICE.find} side="buyer" />;
}
