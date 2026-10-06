import type { Metadata } from 'next';

import { BuyerOrders } from '@/components/buyer/BuyerOrders';

export const metadata: Metadata = { title: 'Orders' };

export default function BuyerOrdersPage() {
  return <BuyerOrders />;
}
