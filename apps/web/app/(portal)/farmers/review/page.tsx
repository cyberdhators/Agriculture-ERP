import type { Metadata } from 'next';

import { ReviewQueue } from '@/components/farmers/ReviewQueue';

export const metadata: Metadata = { title: 'Verify farmers' };

export default function ReviewQueuePage() {
  return <ReviewQueue />;
}
