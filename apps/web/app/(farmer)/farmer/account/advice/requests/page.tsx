import type { Metadata } from 'next';

import { FarmerAdviceRequestsPage } from '@/components/advice/Pages';

export const metadata: Metadata = { title: 'My advice requests' };

export default function Page() {
  return <FarmerAdviceRequestsPage />;
}
