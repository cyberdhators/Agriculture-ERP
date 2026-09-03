import type { ReactNode } from 'react';

import { EntrySpread } from '@/components/farmer/EntrySpread';

export default function EntryLayout({ children }: { children: ReactNode }) {
  return <EntrySpread>{children}</EntrySpread>;
}
