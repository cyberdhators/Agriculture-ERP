import type { Metadata } from 'next';

import { VisitDetailByRole } from '@/components/visits/VisitDetailByRole';

export const metadata: Metadata = { title: 'Visit' };

export default async function VisitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <VisitDetailByRole id={id} />;
}
