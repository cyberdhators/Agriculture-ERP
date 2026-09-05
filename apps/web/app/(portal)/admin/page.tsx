import type { Metadata } from 'next';

import { UserAdmin } from '@/components/admin/UserAdmin';

export const metadata: Metadata = { title: 'User administration' };

export default function AdminPage() {
  return <UserAdmin />;
}
