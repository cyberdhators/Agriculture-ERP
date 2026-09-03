import type { Metadata } from 'next';

import { FarmerRegister } from '@/components/farmer/FarmerRegister';

export const metadata: Metadata = { title: 'Register' };

export default function FarmerRegisterPage() {
  return <FarmerRegister />;
}
