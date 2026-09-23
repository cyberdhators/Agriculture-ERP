import type { Metadata } from 'next';

import { RemapFarmByRole } from '@/components/farms/RemapFarmByRole';

export const metadata: Metadata = { title: 'Re-map a farm' };

export default async function RemapFarmPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RemapFarmByRole farmId={id} />;
}
