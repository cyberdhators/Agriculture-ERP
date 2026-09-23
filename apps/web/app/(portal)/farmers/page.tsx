import type { Metadata } from 'next';
import { Suspense } from 'react';

import { FarmersByRole } from '@/components/farmers/FarmersByRole';

export const metadata: Metadata = { title: 'Farmers' };

export default function FarmersPage() {
  // useSearchParams (filters live in the URL) needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <FarmersByRole />
    </Suspense>
  );
}
