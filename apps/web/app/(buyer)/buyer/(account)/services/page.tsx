import type { Metadata } from 'next';

import { BuyerServicesPage } from '@/components/market-posts/Pages';

export const metadata: Metadata = { title: 'My services' };

export default function Page() {
  return <BuyerServicesPage />;
}
