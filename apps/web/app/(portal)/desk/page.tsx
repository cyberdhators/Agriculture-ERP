import type { Metadata } from 'next';

import { OfficerDashboard } from '@/components/officer/OfficerDashboard';

export const metadata: Metadata = { title: 'Field desk' };

export default function DeskPage() {
  return <OfficerDashboard />;
}
