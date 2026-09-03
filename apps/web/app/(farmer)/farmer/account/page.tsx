import type { Metadata } from 'next';

import { FarmerAccount } from '@/components/farmer/FarmerAccount';

export const metadata: Metadata = { title: 'My account' };

export default function FarmerAccountPage() {
  return <FarmerAccount />;
}
