import type { Metadata } from 'next';

import { StaffAccess } from '@/components/admin/StaffAccess';

export const metadata: Metadata = { title: 'Staff and permissions' };

export default function AdminStaffAccessPage() {
  return <StaffAccess />;
}
