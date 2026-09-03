import type { Metadata } from 'next';

import { EditResource } from '@/components/library/EditResource';

export const metadata: Metadata = { title: 'Edit learning resource' };

export default async function EditResourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EditResource id={id} />;
}
