import type { Metadata } from 'next';

import { VisitsLog } from '@/components/visits/VisitsLog';

export const metadata: Metadata = { title: 'Extension visits' };

export default function VisitsPage() {
  return <VisitsLog />;
}
