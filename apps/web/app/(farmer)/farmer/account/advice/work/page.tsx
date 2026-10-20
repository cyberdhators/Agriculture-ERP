import type { Metadata } from 'next';

import { FarmerAdvisoryWorkPage } from '@/components/advice/Pages';

export const metadata: Metadata = { title: 'My Advisory Work' };

export default function Page() {
  return <FarmerAdvisoryWorkPage />;
}
