import type { Metadata } from 'next';

import { AdviceProviderPage } from '@/components/advice/Pages';

export const metadata: Metadata = { title: 'Adviser' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdviceProviderPage id={id} />;
}
