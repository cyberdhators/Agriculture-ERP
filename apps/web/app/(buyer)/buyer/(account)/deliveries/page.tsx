import type { Metadata } from 'next';

import { BuyerDeliveries } from '@/components/buyer/BuyerDeliveries';

export const metadata: Metadata = { title: 'Deliveries' };

export default function BuyerDeliveriesPage() {
  return <BuyerDeliveries />;
}
