import type { Metadata } from 'next';

import { ProviderForm } from '@/components/advice/ProviderForm';
import { BUYER_ADVICE } from '@/lib/advice/labels';

export const metadata: Metadata = { title: 'Offer advice' };

export default function Page() {
  return <ProviderForm lang="en" base={BUYER_ADVICE.find} workHref={BUYER_ADVICE.work} />;
}
