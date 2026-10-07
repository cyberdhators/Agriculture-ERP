import type { Metadata } from 'next';

import { Procurement } from '@/components/admin/Procurement';

export const metadata: Metadata = { title: 'Buyer requests' };

export default function AdminProcurementPage() {
  return <Procurement />;
}
