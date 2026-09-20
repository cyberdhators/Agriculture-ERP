import type { Metadata } from 'next';

import { FarmerServices } from '@/components/farmer/FarmerServices';

export const metadata: Metadata = { title: 'Services' };

export default function ServicesPage() {
  return <FarmerServices />;
}
