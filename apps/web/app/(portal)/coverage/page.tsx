import type { Metadata } from 'next';
import { Suspense } from 'react';

import { CoverageMap } from '@/components/coverage/CoverageMap';

export const metadata: Metadata = { title: 'Coverage' };

export default function CoveragePage() {
  // The role preview reads from the URL, so a Suspense boundary keeps the page
  // statically renderable.
  return (
    <Suspense fallback={null}>
      <CoverageMap />
    </Suspense>
  );
}
