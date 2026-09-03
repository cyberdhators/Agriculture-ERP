import type { Metadata } from 'next';

import { EditEntry } from '@/components/directories/EditEntry';

export const metadata: Metadata = { title: 'Edit directory entry' };

export default async function EditEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditEntry id={id} />;
}
