import type { Metadata } from 'next';

import { UserAdmin } from '@/components/admin/UserAdmin';

export const metadata: Metadata = { title: 'Users & officers' };

export default function AdminUsersPage() {
  return <UserAdmin />;
}
