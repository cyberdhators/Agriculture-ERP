import type { ReactNode } from 'react';

import { Shell } from '@/components/portal/Shell';
import { PreviewProvider } from '@/lib/preview';

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <PreviewProvider>
      <Shell>{children}</Shell>
    </PreviewProvider>
  );
}
