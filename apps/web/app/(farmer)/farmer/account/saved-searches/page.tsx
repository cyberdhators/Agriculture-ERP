import type { Metadata } from 'next';

import { FarmerSavedSearches } from '@/components/account/SavedSearchPages';

export const metadata: Metadata = { title: 'Saved searches' };

export default function FarmerSavedSearchesPage() {
  return <FarmerSavedSearches />;
}
