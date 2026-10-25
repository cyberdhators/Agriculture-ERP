import type { Metadata } from 'next';

import { BuyerAdviceCases } from '@/components/buyer/BuyerPages';

export const metadata: Metadata = { title: 'My Advisory Work' };

export default function Page() {
  return <BuyerAdviceCases role="provider" />;
}
