import type { Metadata } from 'next';

import { FarmerAccount } from '@/components/farmer/FarmerAccount';

export const metadata: Metadata = { title: 'Account' };

export default function FarmerSettingsPage() {
  return <FarmerAccount />;
}
