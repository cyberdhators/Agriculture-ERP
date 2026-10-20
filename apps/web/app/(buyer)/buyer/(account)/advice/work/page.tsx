import type { Metadata } from 'next';

import { CaseList } from '@/components/advice/CaseList';
import { BUYER_ADVICE } from '@/lib/advice/labels';

export const metadata: Metadata = { title: 'My Advisory Work' };

export default function Page() {
  return <CaseList lang="en" role="provider" side="buyer" findHref={BUYER_ADVICE.find} />;
}
