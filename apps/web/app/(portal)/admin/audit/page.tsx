import type { Metadata } from 'next';

import { AuditTrail } from '@/components/admin/AuditTrail';

export const metadata: Metadata = { title: 'Audit trail' };

export default function AdminAuditPage() {
  return <AuditTrail />;
}
