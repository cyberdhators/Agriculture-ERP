import type { Metadata } from 'next';

import { CaseDetail } from '@/components/advice/CaseDetail';
import { BUYER_ADVICE } from '@/lib/advice/labels';

export const metadata: Metadata = { title: 'Advice request' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <CaseDetail
      id={id}
      lang="en"
      requestsHref={BUYER_ADVICE.requests}
      workHref={BUYER_ADVICE.work}
    />
  );
}
