import type { Metadata } from 'next';

import { ListingForm } from '@/components/farmer/ListingForm';

export const metadata: Metadata = { title: 'Edit produce' };

export default async function EditListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ListingForm listingId={id} />;
}
