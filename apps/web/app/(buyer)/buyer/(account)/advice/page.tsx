import type { Metadata } from 'next';

import { AdviceDirectory } from '@/components/advice/AdviceDirectory';
import { BUYER_ADVICE } from '@/lib/advice/labels';

export const metadata: Metadata = { title: 'Find advice' };

export default function Page() {
  return <AdviceDirectory lang="en" base={BUYER_ADVICE.find} />;
}
