import type { Metadata } from 'next';
import { Suspense } from 'react';

import { MatchAlertResults } from '@/components/analytics/MatchAlertResults';

export const metadata: Metadata = { title: 'Match-alert results' };

export default function MatchAlertResultsPage() {
  // The filters live in the URL (useSearchParams), so a Suspense boundary, as /analytics.
  return (
    <Suspense fallback={null}>
      <MatchAlertResults />
    </Suspense>
  );
}
