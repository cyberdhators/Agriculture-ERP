import type { Metadata } from 'next';

import { FarmerListings } from '@/components/farmer/FarmerListings';

export const metadata: Metadata = { title: 'My produce' };

export default function FarmerListingsPage() {
  return <FarmerListings />;
}
