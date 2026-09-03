import type { Metadata } from 'next';

import { ListingDetail } from '@/components/farmer/ListingDetail';

export const metadata: Metadata = { title: 'Listing' };

export default async function ListingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ListingDetail listingId={id} />;
}
