import type { Metadata } from 'next';

import { BuyerPublicProfilePage } from '@/components/public-profile/Pages';

export const metadata: Metadata = { title: 'My public profile' };

export default function Page() {
  return <BuyerPublicProfilePage />;
}
