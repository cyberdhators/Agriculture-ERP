import type { Metadata } from 'next';

import { RegisterFarmerByRole } from '@/components/farmers/RegisterFarmerByRole';

export const metadata: Metadata = { title: 'Register a farmer' };

export default function RegisterFarmerPage() {
  return <RegisterFarmerByRole />;
}
