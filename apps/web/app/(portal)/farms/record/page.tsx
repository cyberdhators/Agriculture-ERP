import type { Metadata } from 'next';
import { Suspense } from 'react';

import { RecordFarm } from '@/components/farms/RecordFarm';

export const metadata: Metadata = { title: 'Record a farm' };

/**
 * One fixed address, the farmer in the query (?farmer=<id>): the service
 * worker keeps this page on the phone once, and it then opens with no signal
 * for any farmer in the caseload (PWA, 2026-10-10).
 */
export default function RecordFarmPage() {
  return (
    <Suspense fallback={null}>
      <RecordFarm />
    </Suspense>
  );
}
