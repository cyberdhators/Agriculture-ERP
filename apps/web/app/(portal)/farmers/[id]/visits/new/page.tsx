import type { Metadata } from 'next';

import { RecordVisitByRole } from '@/components/visits/RecordVisitByRole';

export const metadata: Metadata = { title: 'Record a visit' };

export default async function RecordVisitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RecordVisitByRole farmerId={id} />;
}
