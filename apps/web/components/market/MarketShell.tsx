'use client';

import type { ReactNode } from 'react';

import { AccountShell } from '@/components/farmer/AccountShell';
import { FarmerShell } from '@/components/farmer/FarmerShell';
import { Shell } from '@/components/portal/Shell';
import { useFarmerSession } from '@/lib/farmer-session';

/** Farmer chrome when a farmer is signed in; the staff shell otherwise. */
export function MarketShell({ children }: { children: ReactNode }) {
  const { farmer } = useFarmerSession();
  if (farmer) {
    return (
      <FarmerShell>
        <AccountShell>{children}</AccountShell>
      </FarmerShell>
    );
  }
  return <Shell>{children}</Shell>;
}
