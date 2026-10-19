import type { Metadata } from 'next';

import { FarmerServiceFormPage } from '@/components/market-posts/Pages';

export const metadata: Metadata = { title: 'New service' };

export default function Page() {
  return <FarmerServiceFormPage />;
}
