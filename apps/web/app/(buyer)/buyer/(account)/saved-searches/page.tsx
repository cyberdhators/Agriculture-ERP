import type { Metadata } from 'next';

import { BuyerSavedSearches } from '@/components/account/SavedSearchPages';

export const metadata: Metadata = { title: 'Saved searches' };

export default function BuyerSavedSearchesPage() {
  return <BuyerSavedSearches />;
}
