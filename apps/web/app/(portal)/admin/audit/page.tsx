import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AuditTrail } from '@/components/admin/AuditTrail';

export const metadata: Metadata = { title: 'Audit trail' };

export default function AdminAuditPage() {
  // useSearchParams (the audit search lives in the URL) needs a Suspense
  // boundary, or the prerender of this page fails.
  return (
    <Suspense fallback={null}>
      <AuditTrail />
    </Suspense>
  );
}
