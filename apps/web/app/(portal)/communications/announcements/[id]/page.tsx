import type { Metadata } from 'next';

import { AnnouncementDetail } from '@/components/communications/AnnouncementDetail';

export const metadata: Metadata = { title: 'Announcement' };

export default async function AnnouncementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AnnouncementDetail id={id} />;
}
