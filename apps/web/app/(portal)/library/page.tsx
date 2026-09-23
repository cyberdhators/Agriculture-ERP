import type { Metadata } from 'next';
import { Suspense } from 'react';

import { LibraryByRole } from '@/components/library/LibraryByRole';

export const metadata: Metadata = { title: 'Learning library' };

export default function LibraryPage() {
  return (
    <Suspense fallback={null}>
      <LibraryByRole />
    </Suspense>
  );
}
