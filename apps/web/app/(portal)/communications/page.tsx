import type { Metadata } from 'next';

import { CommunicationsHub } from '@/components/communications/CommunicationsHub';

export const metadata: Metadata = { title: 'Communications' };

export default function CommunicationsPage() {
  return <CommunicationsHub />;
}
