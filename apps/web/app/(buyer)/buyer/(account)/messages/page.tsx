import type { Metadata } from 'next';

import { BuyerMessages } from '@/components/buyer/BuyerPages';
import { Suspense } from 'react';

export const metadata: Metadata = { title: 'Messages' };

export default function BuyerMessagesPage() {
  return (
    <Suspense>
      <BuyerMessages />
    </Suspense>
  );
}
