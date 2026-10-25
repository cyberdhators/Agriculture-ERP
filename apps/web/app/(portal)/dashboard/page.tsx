import type { Metadata } from 'next';
import { Suspense } from 'react';

import { DashboardHome } from '@/components/portal/DashboardHome';

export const metadata: Metadata = { title: 'Overview' };

export default function DashboardPage() {
  // The administration overview keeps its filters in the URL (useSearchParams),
  // which needs a Suspense boundary for the prerender. Same as /reports.
  return (
    <Suspense fallback={null}>
      <DashboardHome />
    </Suspense>
  );
}
