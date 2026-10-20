import type { Metadata } from 'next';

import { AdviserReview } from '@/components/admin/AdviserReview';

export const metadata: Metadata = { title: 'Approved advisers' };

/** 2026-10-24: the optional approved-adviser pathway, reviewed by moderators. */
export default function AdminAdvisersPage() {
  return <AdviserReview />;
}
