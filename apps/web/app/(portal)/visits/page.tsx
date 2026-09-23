import type { Metadata } from 'next';

import { VisitsByRole } from '@/components/visits/VisitsByRole';

export const metadata: Metadata = { title: 'Extension visits' };

export default function VisitsPage() {
  return <VisitsByRole />;
}
