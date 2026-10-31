import type { ReactNode } from 'react';

import { Shell } from '@/components/portal/Shell';
import { PreviewProvider } from '@/lib/preview';

/**
 * The staff portal.
 *
 * 2026-10-31 (the owner: one look, "consistent"): the portal now wears the
 * member look too -- `.shop`, set on the Shell -- so staff, farmers and
 * buyers see one app. Until today it kept "The Register" (Fraunces, mono
 * figures, 2px corners) by design; see docs/DECISIONS.md, "The staff portal
 * joins the one look".
 */
export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <PreviewProvider>
      <Shell>{children}</Shell>
    </PreviewProvider>
  );
}
