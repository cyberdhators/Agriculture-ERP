import type { Metadata } from 'next';
import { Suspense } from 'react';

import { FarmerAbout } from '@/components/farmer/FarmerAbout';

export const metadata: Metadata = { title: 'About you' };

export default function FarmerAboutPage() {
  return (
    <Suspense fallback={null}>
      <FarmerAbout />
    </Suspense>
  );
}
