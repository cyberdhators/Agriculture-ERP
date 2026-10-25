import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SupportInbox } from '@/components/support/SupportInbox';

export const metadata: Metadata = { title: 'Support cases' };

/**
 * 2026-10-21: "Contact CORWADO" messages. 2026-10-28: support cases (the
 * specification's line 103). Filters live in the URL, hence Suspense.
 */
export default function AdminSupportPage() {
  return (
    <Suspense fallback={null}>
      <SupportInbox />
    </Suspense>
  );
}
