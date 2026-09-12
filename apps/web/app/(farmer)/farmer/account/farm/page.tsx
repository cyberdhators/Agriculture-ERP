import type { Metadata } from 'next';

import { FarmerFarm } from '@/components/farmer/FarmerFarm';

export const metadata: Metadata = { title: 'My farm' };

export default function FarmerFarmPage() {
  return <FarmerFarm />;
}
