import type { ReactNode } from 'react';

import { BuyerShell } from '@/components/buyer/BuyerShell';

/**
 * The buyer side (B13), in "The Register" like the staff portal: a buyer is a
 * professional user doing procurement work, not a marketplace shopper. The
 * session is required by the middleware; the role by every route, and by the
 * shell, which sends anyone who is not a buyer back where they belong.
 */
export default function BuyerAccountLayout({ children }: { children: ReactNode }) {
  return <BuyerShell>{children}</BuyerShell>;
}
