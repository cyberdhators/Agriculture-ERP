import type { Metadata } from 'next';

import { CaseList } from '@/components/advice/CaseList';
import { BUYER_ADVICE } from '@/lib/advice/labels';

export const metadata: Metadata = { title: 'My advice requests' };

export default function Page() {
  return <CaseList lang="en" role="requester" side="buyer" findHref={BUYER_ADVICE.find} />;
}
