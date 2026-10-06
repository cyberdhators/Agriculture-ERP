import type { Metadata } from 'next';

import { BuyerProfile } from '@/components/buyer/BuyerProfile';

export const metadata: Metadata = { title: 'Organisation profile' };

export default function BuyerProfilePage() {
  return <BuyerProfile />;
}
