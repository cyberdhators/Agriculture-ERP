import type { ReactNode } from 'react';

import { Shell } from '@/components/portal/Shell';
import { PreviewProvider } from '@/lib/preview';

/**
 * The staff portal, in "The Register".
 *
 * NOT wrapped in `.shop`. That class remaps every Register token onto the
 * Amazon-style farmer/marketplace scope — Open Sans over Fraunces, cool grey
 * over bone, 8px radii over 2px — and globals.css says in its own words that
 * "the staff portal (app/(portal)/**) is never wrapped in `.shop` and stays
 * exactly as the Register defines it". The wrapper was here anyway, so the
 * portal has been rendering in the marketplace skin against its own rule.
 * Removing it restores Fraunces, bone paper and the 2px controls the design
 * decision calls for. The farmer and market surfaces keep `.shop`; they are
 * where it belongs.
 */
export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <PreviewProvider>
      <Shell>{children}</Shell>
    </PreviewProvider>
  );
}
