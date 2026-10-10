import type { Metadata } from 'next';

import { RecordFarm } from '@/components/farms/RecordFarm';

export const metadata: Metadata = { title: 'Record a farm' };

export default async function RecordFarmPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RecordFarm farmerId={id} />;
}
