import type { Metadata } from 'next';

import { FarmerEditByRole } from '@/components/farmers/FarmerEditByRole';

export const metadata: Metadata = { title: 'Correct farmer' };

export default async function FarmerEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FarmerEditByRole id={id} />;
}
