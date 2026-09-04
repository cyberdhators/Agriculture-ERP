import type { ReactNode } from 'react';

import { Shell } from '@/components/portal/Shell';
import { PreviewProvider } from '@/lib/preview';

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <PreviewProvider>
      <div className="shop">
        <Shell>{children}</Shell>
      </div>
    </PreviewProvider>
  );
}
