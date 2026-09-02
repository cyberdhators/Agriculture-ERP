import type { Metadata } from 'next';

import { DesignPage } from '@/components/portal/DesignPage';

export const metadata: Metadata = { title: 'Design system' };

export default function Page() {
  return <DesignPage />;
}
