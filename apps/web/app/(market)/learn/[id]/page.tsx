import type { Metadata } from 'next';

import { GuidePage } from '@/components/learn/Guides';

export const metadata: Metadata = { title: 'Guide' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GuidePage id={id} />;
}
