import type { Metadata } from 'next';

import { BuyerCart } from '@/components/buyer/BuyerCart';

export const metadata: Metadata = { title: 'Cart' };

export default function BuyerCartPage() {
  return <BuyerCart />;
}
