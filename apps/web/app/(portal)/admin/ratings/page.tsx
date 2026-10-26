import type { Metadata } from 'next';

import { RatingsModeration } from '@/components/admin/RatingsModeration';

export const metadata: Metadata = { title: 'Ratings' };

/** 2026-11-03 (lane-trust): reported ratings, hidden with a reason by moderators. */
export default function AdminRatingsPage() {
  return <RatingsModeration />;
}
