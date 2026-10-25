import type { Metadata } from 'next';

import { AdviserReview } from '@/components/admin/AdviserReview';
import { AdvisoryNoteReview } from '@/components/admin/AdvisoryNoteReview';

export const metadata: Metadata = { title: 'Approved advisers' };

/**
 * 2026-10-24: the optional approved-adviser pathway, reviewed by moderators.
 * 2026-10-28: and the approved-adviser channel -- official advisory notes.
 */
export default function AdminAdvisersPage() {
  return (
    <>
      <AdviserReview />
      <AdvisoryNoteReview />
    </>
  );
}
