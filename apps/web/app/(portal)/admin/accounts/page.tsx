import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AccountsAdmin } from '@/components/admin/AccountsAdmin';

export const metadata: Metadata = { title: 'Users and organizations' };

/** 2026-10-28: every account in one list. Its filters live in the URL, hence Suspense. */
export default function AdminAccountsPage() {
  return (
    <Suspense fallback={null}>
      <AccountsAdmin />
    </Suspense>
  );
}
