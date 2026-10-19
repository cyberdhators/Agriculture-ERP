import type { Metadata } from 'next';

import { FarmerServicesPage } from '@/components/market-posts/Pages';

export const metadata: Metadata = { title: 'My services' };

export default function Page() {
  return <FarmerServicesPage />;
}
