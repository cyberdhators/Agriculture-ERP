import type { Metadata } from 'next';
import { Suspense } from 'react';

import { GuidesPage } from '@/components/learn/Guides';

export const metadata: Metadata = { title: 'Guides' };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <GuidesPage />
    </Suspense>
  );
}
