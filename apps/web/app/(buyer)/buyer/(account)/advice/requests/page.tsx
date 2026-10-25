import type { Metadata } from 'next';

import { BuyerAdviceCases } from '@/components/buyer/BuyerPages';

export const metadata: Metadata = { title: 'My advice requests' };

export default function Page() {
  return <BuyerAdviceCases role="requester" />;
}
