import type { Metadata } from 'next';

import { FarmerSecurity } from '@/components/farmer/FarmerSecurity';

export const metadata: Metadata = { title: 'Login & Security' };

export default function SecurityPage() {
  return <FarmerSecurity />;
}
