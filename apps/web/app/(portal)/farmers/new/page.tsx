import type { Metadata } from 'next';

import { RegisterFarmer } from '@/components/farmers/RegisterFarmer';

export const metadata: Metadata = { title: 'Help a farmer register' };

export default function RegisterFarmerPage() {
  return <RegisterFarmer />;
}
