import type { Metadata } from 'next';

import { BuyerMarketplace } from '@/components/buyer/BuyerMarketplace';

export const metadata: Metadata = { title: 'Marketplace' };

export default function BuyerMarketplacePage() {
  return <BuyerMarketplace />;
}
