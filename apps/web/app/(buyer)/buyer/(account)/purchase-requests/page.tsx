import type { Metadata } from 'next';

import { BuyerRequests } from '@/components/buyer/BuyerRequests';

export const metadata: Metadata = { title: 'Purchase requests' };

export default function BuyerRequestsPage() {
  return <BuyerRequests />;
}
