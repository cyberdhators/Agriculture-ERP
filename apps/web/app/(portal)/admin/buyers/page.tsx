import type { Metadata } from 'next';
import { Suspense } from 'react';

import { BuyerReview } from '@/components/admin/BuyerReview';

export const metadata: Metadata = { title: 'Buyer accounts' };

export default function AdminBuyersPage() {
  // The review reads ?standing= (an appeal's link), which needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <BuyerReview />
    </Suspense>
  );
}
