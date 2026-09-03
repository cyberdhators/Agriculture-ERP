import type { ReactNode } from 'react';

import { MarketModerationProvider } from '@/components/market/moderation';

export default function MarketLayout({ children }: { children: ReactNode }) {
  return <MarketModerationProvider>{children}</MarketModerationProvider>;
}
