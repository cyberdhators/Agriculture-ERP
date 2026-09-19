import type { Metadata } from 'next';
import { Suspense } from 'react';

import { Reports } from '@/components/reports/Reports';

export const metadata: Metadata = { title: 'Reports' };

export default function ReportsPage() {
  // useSearchParams (report filters live in the URL) needs a Suspense boundary,
  // or the prerender of this page fails. Same pattern as /farmers and /library.
  return (
    <Suspense fallback={null}>
      <Reports />
    </Suspense>
  );
}
