import type { Metadata } from 'next';

import { Reports } from '@/components/reports/Reports';

export const metadata: Metadata = { title: 'Reports' };

export default function ReportsPage() {
  return <Reports />;
}
