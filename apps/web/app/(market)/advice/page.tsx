import type { Metadata } from 'next';

import { AdviceDirectoryPage } from '@/components/advice/Pages';

export const metadata: Metadata = { title: 'Find advice' };

export default function Page() {
  return <AdviceDirectoryPage />;
}
