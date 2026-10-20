import type { Metadata } from 'next';

import { FarmerOfferAdvicePage } from '@/components/advice/Pages';

export const metadata: Metadata = { title: 'Offer advice' };

export default function Page() {
  return <FarmerOfferAdvicePage />;
}
