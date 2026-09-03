import type { Metadata } from 'next';
import { Suspense } from 'react';

import { DirectoriesScreen } from '@/components/directories/DirectoriesScreen';

export const metadata: Metadata = { title: 'Directories' };

export default function DirectoriesPage() {
  // useSearchParams needs a Suspense boundary for static rendering.
  return (
    <Suspense fallback={null}>
      <DirectoriesScreen />
    </Suspense>
  );
}
