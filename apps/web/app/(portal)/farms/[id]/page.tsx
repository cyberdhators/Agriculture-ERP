import type { Metadata } from 'next';

import { FarmDetailByRole } from '@/components/farms/FarmDetailByRole';

export const metadata: Metadata = { title: 'Farm' };

export default async function FarmPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FarmDetailByRole farmId={id} />;
}
