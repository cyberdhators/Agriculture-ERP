import type { Metadata } from 'next';

import { FarmerVerification } from '@/components/farmer/FarmerVerification';

export const metadata: Metadata = { title: 'Your record' };

export default function VerificationPage() {
  return <FarmerVerification />;
}
