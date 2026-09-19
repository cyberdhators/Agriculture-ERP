import type { Metadata } from 'next';

import { Communications } from '@/components/communications/Communications';

export const metadata: Metadata = { title: 'Communications' };

export default function CommunicationsPage() {
  return <Communications />;
}
