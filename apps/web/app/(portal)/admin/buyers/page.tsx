import type { Metadata } from 'next';

import { BuyerReview } from '@/components/admin/BuyerReview';

export const metadata: Metadata = { title: 'Buyer accounts' };

export default function AdminBuyersPage() {
  return <BuyerReview />;
}
