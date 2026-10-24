import type { Metadata } from 'next';

import { BuyerServiceFormPage } from '@/components/market-posts/Pages';

export const metadata: Metadata = { title: 'New service' };

export default function Page() {
  return <BuyerServiceFormPage />;
}
