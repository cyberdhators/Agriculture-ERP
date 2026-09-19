import type { Metadata } from 'next';

import { FarmsMap } from '@/components/farms/FarmsMap';

export const metadata: Metadata = { title: 'Farms & maps' };

export default function FarmsPage() {
  return <FarmsMap />;
}
