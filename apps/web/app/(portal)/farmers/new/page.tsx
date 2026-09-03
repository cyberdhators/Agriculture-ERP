import type { Metadata } from 'next';

import { RegisterFarmer } from '@/components/farmers/RegisterFarmer';

export const metadata: Metadata = { title: 'Register a farmer' };

export default function RegisterFarmerPage() {
  return <RegisterFarmer />;
}
