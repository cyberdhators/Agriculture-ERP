import type { Metadata } from 'next';
import { Suspense } from 'react';

import { FarmersRegister } from '@/components/farmers/FarmersRegister';

export const metadata: Metadata = { title: 'Farmers' };

export default function FarmersPage() {
  // useSearchParams (filters live in the URL) needs a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <FarmersRegister />
    </Suspense>
  );
}
