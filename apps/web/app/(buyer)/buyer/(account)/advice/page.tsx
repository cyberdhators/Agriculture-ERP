import type { Metadata } from 'next';

import { BuyerAdviceDirectory } from '@/components/buyer/BuyerPages';

export const metadata: Metadata = { title: 'Find advice' };

export default function Page() {
  return <BuyerAdviceDirectory />;
}
