import type { Metadata } from 'next';

import { FarmerOverview } from '@/components/farmer/FarmerOverview';

export const metadata: Metadata = { title: 'Overview' };

export default function FarmerOverviewPage() {
  return <FarmerOverview />;
}
