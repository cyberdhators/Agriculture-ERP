import type { Metadata } from 'next';

import { FarmerPublicProfilePage } from '@/components/public-profile/Pages';

export const metadata: Metadata = { title: 'My public profile' };

export default function Page() {
  return <FarmerPublicProfilePage />;
}
