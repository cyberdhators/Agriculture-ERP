import type { Metadata } from 'next';

import { Overview } from '@/components/portal/Overview';

export const metadata: Metadata = { title: 'Overview' };

export default function DashboardPage() {
  return <Overview />;
}
