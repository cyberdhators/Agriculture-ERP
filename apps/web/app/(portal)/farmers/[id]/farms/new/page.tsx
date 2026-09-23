import type { Metadata } from 'next';

import { MapFarmByRole } from '@/components/farms/MapFarmByRole';

export const metadata: Metadata = { title: 'Map a farm' };

export default async function MapFarmPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MapFarmByRole farmerId={id} />;
}
