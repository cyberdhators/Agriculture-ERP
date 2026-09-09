import type { ReactNode } from 'react';

import { AccountShell } from '@/components/farmer/AccountShell';

export default function AccountLayout({ children }: { children: ReactNode }) {
  return <AccountShell>{children}</AccountShell>;
}
