import type { Metadata } from 'next';

import { AccessLogs } from '@/components/admin/AccessLogs';

export const metadata: Metadata = { title: 'Access logs' };

export default function AdminAccessLogsPage() {
  return <AccessLogs />;
}
