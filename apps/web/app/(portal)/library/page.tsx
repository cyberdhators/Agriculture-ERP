import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LibraryScreen } from '@/components/library/LibraryScreen';

export const metadata: Metadata = { title: 'Learning library' };

export default function LibraryPage() {
  return (
    <Suspense fallback={null}>
      <LibraryScreen />
    </Suspense>
  );
}
