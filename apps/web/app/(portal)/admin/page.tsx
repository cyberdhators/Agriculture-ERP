import type { Metadata } from 'next';

import { AdminHub } from '@/components/admin/AdminHub';

export const metadata: Metadata = { title: 'Administration' };

export default function AdminPage() {
  return <AdminHub />;
}
