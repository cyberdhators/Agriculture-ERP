import type { Metadata } from 'next';

import { FarmerPrices } from '@/components/farmer/FarmerPrices';

export const metadata: Metadata = { title: 'Market prices' };

export default function PricesPage() {
  return <FarmerPrices />;
}
