import type { Metadata } from 'next';

import { FarmerLogin } from '@/components/farmer/FarmerLogin';

export const metadata: Metadata = { title: 'Sign in' };

export default function FarmerLoginPage() {
  return <FarmerLogin />;
}
