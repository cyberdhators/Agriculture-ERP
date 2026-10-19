import type { Metadata } from 'next';

import { StartBuying } from '@/components/farmer/StartBuying';

export const metadata: Metadata = { title: 'Buy' };

export default function StartBuyingPage() {
  return <StartBuying />;
}
