import type { Metadata } from 'next';
import { Suspense } from 'react';

import { MarketplaceConsole } from '@/components/admin/MarketplaceConsole';

export const metadata: Metadata = { title: 'Marketplace' };

/** 2026-10-28: the staff marketplace console. Its filters live in the URL, hence Suspense. */
export default function AdminMarketplacePage() {
  return (
    <Suspense fallback={null}>
      <MarketplaceConsole />
    </Suspense>
  );
}
