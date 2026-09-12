import type { Metadata } from 'next';

import { FarmerListings } from '@/components/farmer/FarmerListings';

export const metadata: Metadata = { title: 'My listings' };

export default function FarmerListingsPage() {
  return <FarmerListings />;
}
