import type { Metadata } from 'next';

import { StartSelling } from '@/components/buyer/StartSelling';

export const metadata: Metadata = { title: 'Start selling' };

export default function StartSellingPage() {
  return <StartSelling />;
}
