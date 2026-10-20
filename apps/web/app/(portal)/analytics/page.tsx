import type { Metadata } from 'next';
import { Suspense } from 'react';

import { Analytics } from '@/components/analytics/Analytics';

export const metadata: Metadata = { title: 'Marketplace analytics' };

export default function AnalyticsPage() {
  // useSearchParams (the window and state live in the URL) needs a Suspense
  // boundary, or the prerender of this page fails. Same pattern as /reports.
  return (
    <Suspense fallback={null}>
      <Analytics />
    </Suspense>
  );
}
