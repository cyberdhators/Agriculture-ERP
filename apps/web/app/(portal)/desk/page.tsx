import type { Metadata } from 'next';

import { OfficerDesk } from '@/components/officer/OfficerDesk';

export const metadata: Metadata = { title: 'Field desk' };

export default function DeskPage() {
  return <OfficerDesk />;
}
