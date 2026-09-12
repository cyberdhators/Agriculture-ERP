import type { Metadata } from 'next';

import { ListingForm } from '@/components/farmer/ListingForm';

export const metadata: Metadata = { title: 'New listing' };

export default function NewListingPage() {
  return <ListingForm />;
}
